import { Request, Response } from "express";
import { validationResult } from "express-validator";
import { RowDataPacket } from "mysql2";
import IORedis from "ioredis";

import pool from "../database";
import { fetchGroupHierarchyBelow } from "../helpers/fetchGroupHierarchyBelow";
import { getOrSetCache, clearKeysStartingWith } from "../helpers/redis_helpers";

const redisClient = new IORedis();

interface FilterCriteria {
	jobTitle?: string;
	firstName?: string;
}

export const getGroups = async (req: Request, res: Response) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(422).json({ errors: errors.array() });
	}

	const { id, jobTitle, firstName } = req.query;

	if (id) {
		try {
			const filterCriteria: FilterCriteria[] = [];

			if (jobTitle) {
				filterCriteria.push({ jobTitle: jobTitle as string });
			}

			if (firstName) {
				filterCriteria.push({ firstName: firstName as string });
			}

			// Fetch the root group and its children groups recursively
			const groupHierarchy = await fetchGroupHierarchyBelow(
				parseInt(id as string),
				filterCriteria
			);

			if ("error" in groupHierarchy) {
				return res.status(404).json({ error: groupHierarchy.error });
			}

			res.json(groupHierarchy);
		} catch (error) {
			console.error("Error retrieving group hierarchy:", error);
			res.status(500).json({ error: "Internal server error" });
		}
	} else {
		const cacheKey = "all_groups";

		try {
			const groupsData = await getOrSetCache<RowDataPacket[]>(
				cacheKey,
				async () => {
					const [groups] = await pool.query("SELECT * FROM `group` ");

					// Cast the result to an array of RowDataPacket
					const groupsData = groups as RowDataPacket[];

					if (groupsData.length === 0) {
						throw new Error("There are no groups.");
					}

					return groupsData;
				}
			);

			// Send the cached or freshly fetched data in the response
			res.json(groupsData);
		} catch (error) {
			// Handle any errors
			console.error("Error fetching groups:", error);
			res.status(500).json({ error: "Internal server error." });
		}
	}
};

export const createGroup = async (req: Request, res: Response) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(422).json({ errors: errors.array() });
	}

	const { groupName, parentGroupId } = req.body;

	try {
		await pool.query(
			"INSERT INTO `group` (groupName, parentGroupId) VALUES (?, ?)",
			[groupName, parentGroupId]
		);

		// Clear redis cache regarding groups
		redisClient.del("all_groups");
		clearKeysStartingWith("groups_below_");
		clearKeysStartingWith("groups_above_");

		res.json({ message: "Group created successfully!" });
	} catch (error) {
		console.error("Error creating group:", error);
		res.status(500).json({ error: "Internal server error" });
	}
};

export const updateGroup = async (req: Request, res: Response) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(422).json({ errors: errors.array() });
	}

	const { id } = req.query;
	let { groupName, parentGroupId } = req.body;

	// Handle parentGroupId being sent as null in the request body
	if (parentGroupId === null || parentGroupId === "null") {
		parentGroupId = null;
	}

	try {
		// Check if the group exists
		const [existingGroup] = await pool.query(
			"SELECT * FROM `group` WHERE id = ?",
			[id]
		);

		// Cast the result to an array of RowDataPacket
		const existingGroupData = existingGroup as RowDataPacket[];

		if (existingGroupData.length === 0) {
			return res.status(404).json({ error: "Group not found." });
		}

		// Check for circular reference
		if (parentGroupId !== undefined) {
			const groupId = existingGroupData[0].id;

			// Recursive query to find all descendants of the group being updated
			const descendantQuery = `
            WITH RECURSIVE Descendants AS (
                SELECT id, parentGroupId FROM \`group\` WHERE id = ?
                UNION ALL
                SELECT g.id, g.parentGroupId FROM Descendants d
                JOIN \`group\` g ON d.id = g.parentGroupId
            )
            SELECT id FROM Descendants;
        `;

			const [descendants] = await pool.query(descendantQuery, [groupId]);

			// Use type assertion to treat the array elements consistently as RowDataPacket
			const descendantIds = (descendants as RowDataPacket[]).map(
				(row: RowDataPacket) => row.id
			);

			if (descendantIds.includes(Number(parentGroupId))) {
				return res
					.status(400)
					.json({ error: "Circular reference detected." });
			}
		}

		let updateFields = [];
		let params = [];

		if (groupName) {
			updateFields.push("groupName = ?");
			params.push(groupName);
		}

		if (parentGroupId !== undefined) {
			updateFields.push("parentGroupId = ?");
			params.push(parentGroupId);

			const currentGroupId = existingGroupData[0].id;

			if (parentGroupId === currentGroupId) {
				return res.status(400).json({ error: "Error updating group." });
			}

			await pool.query(
				"UPDATE `group` SET parentGroupId = NULL WHERE id = ?",
				[currentGroupId]
			);

			await pool.query(
				"UPDATE `group` SET updatedAt = CURRENT_TIMESTAMP WHERE id = ?",
				[parentGroupId]
			);
		}

		if (updateFields.length === 0) {
			return res.status(400).json({ error: "No fields to update." });
		}

		params.push(id);

		const updateQuery = `UPDATE \`group\` SET ${updateFields.join(
			", "
		)} WHERE id = ?`;

		await pool.query(updateQuery, params);

		// Clear redis cache regarding groups
		redisClient.del("all_groups");
		clearKeysStartingWith("groups_below_");
		clearKeysStartingWith("groups_above_");

		res.json({ message: "Group updated successfully!" });
	} catch (error) {
		console.error("Error creating group:", error);
		res.status(500).json({ error: "Internal server error" });
	}
};

export const deleteGroup = async (req: Request, res: Response) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(422).json({ errors: errors.array() });
	}

	const { id } = req.query;

	try {
		await pool.query("DELETE FROM `group` WHERE id = ?", [id]);

		// Clear redis cache regarding groups
		redisClient.del("all_groups");
		clearKeysStartingWith("groups_below_");
		clearKeysStartingWith("groups_above_");

		res.json({ message: "Group deleted successfully!" });
	} catch (error) {
		console.error("Error deleting Group:", error);
		res.status(500).json({ error: "Internal server error" });
	}
};
