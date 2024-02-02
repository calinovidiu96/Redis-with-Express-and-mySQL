import { RowDataPacket } from "mysql2";
import pool from "../database";
import { getOrSetCache } from "./redis_helpers";

interface Group {
	id?: number;
	groupName?: string;
	persons: Person[];
	groups: Group[];
}

interface Person {
	id: number;
	firstName: string;
	lastName: string;
	jobTitle: string;
}

type GroupOrError = Group | { error: string };

interface FilterCriteria {
	jobTitle?: string;
	firstName?: string;
}

export const fetchGroupHierarchyBelow = async (
	groupId: number,
	filterCriteria: FilterCriteria[]
): Promise<GroupOrError> => {
	// Cache key combining groupId and filterCriteria
	const cacheKey = `groups_below_${groupId}_${JSON.stringify(
		filterCriteria
	)}`;

	// Using the custom cache function to retrieve or set data in Redis
	return getOrSetCache<GroupOrError>(cacheKey, async () => {
		const group: Group = {
			id: groupId,
			groupName: "", // Will be updated below
			persons: [],
			groups: [],
		};

		// Fetch group details
		const [groupResult] = await pool.query(
			"SELECT groupName, parentGroupId FROM `group` WHERE id = ?",
			[groupId]
		);
		const groupRow = (groupResult as RowDataPacket[])[0];
		if (!groupRow) {
			return { error: `Group with ID ${groupId} not found` };
		}

		group.groupName = groupRow.groupName;

		// Construct SQL filter conditions based on criteria
		const conditions: string[] = [];
		const params: any[] = [groupId]; // groupId is always included

		filterCriteria.forEach((criteria) => {
			if (criteria.jobTitle) {
				conditions.push("jobTitle = ?");
				params.push(criteria.jobTitle);
			}
			if (criteria.firstName) {
				conditions.push("firstName = ?");
				params.push(criteria.firstName);
			}
		});

		const filterCondition =
			conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";

		// Fetch persons for the current group with optional filters
		const [personsResult] = await pool.query(
			`SELECT id, firstName, lastName, jobTitle, groupId FROM person WHERE groupId = ? ${filterCondition}`,
			params
		);

		const persons = personsResult as RowDataPacket[];
		persons.forEach((personRow) => {
			group.persons.push({
				id: personRow.id,
				firstName: personRow.firstName,
				lastName: personRow.lastName,
				jobTitle: personRow.jobTitle,
			});
		});

		// Fetch child groups for the current group
		const [childGroupsResult] = await pool.query(
			"SELECT id, groupName FROM `group` WHERE parentGroupId = ?",
			[groupId]
		);

		const childGroups = childGroupsResult as RowDataPacket[];

		for (const childGroupRow of childGroups) {
			const childGroupOrError: GroupOrError =
				await fetchGroupHierarchyBelow(
					childGroupRow.id,
					filterCriteria
				);

			if ("error" in childGroupOrError) {
				return childGroupOrError;
			}
			group.groups.push({
				id: childGroupRow.id,
				groupName: childGroupRow.groupName,
				persons: childGroupOrError.persons,
				groups: childGroupOrError.groups,
			});
		}

		return group;
	});
};
