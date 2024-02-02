import { Request, Response } from "express";
import { validationResult } from "express-validator";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import IORedis from "ioredis";

import pool from "../database";
import { fetchGroupHierarchyAbove } from "../helpers/fetchGroupHierarchyAbove";
import { getOrSetCache, clearKeysStartingWith } from "../helpers/redis_helpers";

const redisClient = new IORedis();

interface Person {
	id: number;
	firstName: string;
	lastName: string;
	jobTitle: string;
}

type PersonOrError = Person | { error: string };

export const getPersons = async (
	req: Request,
	res: Response
): Promise<PersonOrError | undefined> => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		res.status(422).json({ errors: errors.array() });
		return { error: "Validation error" };
	}

	const { id } = req.query;

	if (id) {
		try {
			const cacheKey = `person_id_${id}`;

			const personData = await getOrSetCache<RowDataPacket[]>(
				cacheKey,
				async () => {
					const [person] = await pool.query(
						"SELECT * FROM person WHERE id = ?",
						[id]
					);
					// // Cast the result to an array of RowDataPacket
					const personRow = person as RowDataPacket[];

					if (personRow.length === 0) {
						throw new Error("Person not found.");
					}
					return personRow;
				}
			);

			// Send the cached or freshly fetched data in the response
			res.json(personData);
		} catch (error) {
			console.error(`Error fetching person with id: ${id}`, error);
			res.status(500).json({ error: "Internal server error" });
		}
	} else {
		try {
			const cacheKey = "all_persons";

			const personsData = await getOrSetCache<RowDataPacket[]>(
				cacheKey,
				async () => {
					const [persons] = await pool.query("SELECT * FROM person");

					// Cast the result to an array of RowDataPacket
					const personsRows = persons as RowDataPacket[];

					if (personsRows.length === 0) {
						throw new Error("Person not found.");
					}

					return personsRows;
				}
			);

			// Send the cached or freshly fetched data in the response
			res.json(personsData);
		} catch (error) {
			console.error("Error fetching persons:", error);
			res.status(500).json({ error: "Internal server error" });
		}
	}
};

export const createPerson = async (req: Request, res: Response) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(422).json({ errors: errors.array() });
	}

	const { firstName, lastName, jobTitle, groupId } = req.body;

	try {
		await pool.query(
			"INSERT INTO person (firstName, lastName, jobTitle, groupId) VALUES (?, ?, ?, ?)",
			[firstName, lastName, jobTitle, groupId]
		);

		// Clear redis cache regarding groups
		redisClient.del("all_persons");

		res.json({ message: "Person created successfully!" });
	} catch (error) {
		console.error("Error creating person:", error);
		res.status(500).json({ error: "Internal server error" });
	}
};

export const updatePerson = async (req: Request, res: Response) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(422).json({ errors: errors.array() });
	}

	const { id } = req.query;
	let { firstName, lastName, jobTitle, groupId } = req.body;

	// Handle groupId being sent as null in the request body
	if (groupId === null || groupId === "null") {
		groupId = null;
	}

	try {
		// Check if the person exists
		const [existingPerson] = await pool.query(
			"SELECT groupId FROM person WHERE id = ?",
			[id]
		);

		// Cast the result to an array of RowDataPacket
		const existingPersonData = existingPerson as RowDataPacket[];

		if (existingPersonData.length === 0) {
			return res.status(404).json({ error: "Person not found." });
		}

		let updateFields = [];
		let params = [];

		if (firstName) {
			updateFields.push("firstName = ?");
			params.push(firstName);
		}

		if (lastName) {
			updateFields.push("lastName = ?");
			params.push(lastName);
		}

		if (jobTitle) {
			updateFields.push("jobTitle = ?");
			params.push(jobTitle);
		}

		if (groupId !== undefined) {
			updateFields.push("groupId = ?");
			params.push(groupId);

			// Use groupId from existing person data
			const currentGroupId = existingPersonData[0].groupId;

			// Update the updatedAt timestamp for the current group
			await pool.query(
				"UPDATE `group` SET updatedAt = CURRENT_TIMESTAMP WHERE id = ?",
				[currentGroupId]
			);

			// Update just if it has new group
			if (groupId) {
				// Update the updatedAt timestamp for the new group
				await pool.query(
					"UPDATE `group` SET updatedAt = CURRENT_TIMESTAMP WHERE id = ?",
					[groupId]
				);
			}
		}

		if (updateFields.length === 0) {
			return res.status(400).json({ error: "No fields to update." });
		}

		params.push(id);

		const updateQuery = `UPDATE person SET ${updateFields.join(
			", "
		)} WHERE id = ?`;

		await pool.query(updateQuery, params);

		// Clear redis cache regarding groups
		redisClient.del("all_persons");
		clearKeysStartingWith(`person_id_${id}`);

		res.json({ message: "Person updated successfully!" });
	} catch (error) {
		console.error("Error updating person:", error);
		res.status(500).json({ error: "Internal server error" });
	}
};

export const deletePerson = async (req: Request, res: Response) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		return res.status(422).json({ errors: errors.array() });
	}

	const { id } = req.query;

	try {
		await pool.query("DELETE FROM person WHERE id = ?", [id]);

		// Clear redis cache regarding groups
		redisClient.del("all_persons");
		clearKeysStartingWith(`person_id_${id}`);

		res.json({ message: "Person deleted successfully!" });
	} catch (error) {
		console.error("Error deleting person:", error);
		res.status(500).json({ error: "Internal server error" });
	}
};

export const getGroupsAbove = async (req: Request, res: Response) => {
	const errors = validationResult(req);
	if (!errors.isEmpty()) {
		res.status(422).json({ errors: errors.array() });
		return { error: "Validation error" };
	}

	const { id } = req.query;

	try {
		// Fetch the group ID of the person
		const [person] = await pool.query(
			"SELECT groupId FROM person WHERE id = ?",
			[id]
		);

		// Cast the result to an array of RowDataPacket
		const personData = person as RowDataPacket[];

		if (personData.length === 0) {
			res.status(404).json({ error: "Person not found." });
			return { error: "Person not found." };
		}

		const groupId: number | null = personData[0].groupId;
		if (groupId === null) {
			return res
				.status(404)
				.json({ error: "No group associated with the person." });
		}

		// Recursively fetch group hierarchy
		const groupsHierarchy = await fetchGroupHierarchyAbove(groupId);

		res.json(groupsHierarchy);
	} catch (error) {
		console.error("Error fetching groups above person:", error);
		throw error;
	}
};
