import { RowDataPacket } from "mysql2";

import pool from "../database";
import { getOrSetCache } from "./redis_helpers";

interface Group {
	id?: number;
	groupName?: string;
	parentGroup: Group[];
}

type GroupOrError = Group | { error: string };

export const fetchGroupHierarchyAbove = async (
	groupId: number
): Promise<GroupOrError> => {
	const cacheKey = `group_above_${groupId}}`;

	// Using the custom cache function to retrieve or set data in Redis
	return getOrSetCache<GroupOrError>(cacheKey, async () => {
		// Fetch the group details for the provided groupId
		const [groupResult] = await pool.query(
			"SELECT id, groupName, parentGroupId FROM `group` WHERE id = ?",
			[groupId]
		);
		const groupRow = (groupResult as RowDataPacket[])[0];
		if (!groupRow) {
			return { error: `Group with ID ${groupId} not found` };
		}

		const group: Group = {
			id: groupRow.id,
			groupName: groupRow.groupName,
			parentGroup: [],
		};

		// Recursive function to fetch parent groups and construct the hierarchy
		async function fetchparentGroupRecursive(
			currentGroupId: number,
			currentGroup: Group
		): Promise<void> {
			// Fetch group details for the current group
			const [currentGroupResult] = await pool.query(
				"SELECT id, groupName, parentGroupId FROM `group` WHERE id = ?",
				[currentGroupId]
			);
			const currentGroupRow = (currentGroupResult as RowDataPacket[])[0];
			if (!currentGroupRow) {
				return; // Stop recursion
			}

			// Fetch parent group details
			const [parentGroupResult] = await pool.query(
				"SELECT id, groupName, parentGroupId FROM `group` WHERE id = ?",
				[currentGroupRow.parentGroupId]
			);
			const parentGroupRow = (parentGroupResult as RowDataPacket[])[0];
			if (!parentGroupRow) {
				return; // Stop recursion
			}

			const parentGroup: Group = {
				id: parentGroupRow.id,
				groupName: parentGroupRow.groupName,
				parentGroup: [],
			};

			// Recursively fetch parent groups for the current group
			await fetchparentGroupRecursive(parentGroupRow.id, parentGroup);

			// Add the parent group to the list of parent groups
			currentGroup.parentGroup.push(parentGroup);
		}

		// Start fetching parent groups recursively
		await fetchparentGroupRecursive(groupId, group);

		return group;
	});
};
