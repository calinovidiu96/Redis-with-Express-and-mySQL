import { Router } from "express";
import { check } from "express-validator";

import {
	getPersons,
	createPerson,
	deletePerson,
	updatePerson,
	getGroupsAbove,
} from "../controllers/persons-controller";

const router = Router();

// Get Person (or all persons if no id)
router.get("/", check("id").optional().isNumeric(), getPersons);

// Create Person
router.post(
	"/create",
	[
		check("firstName").isString().isLength({ min: 2 }),
		check("lastName").isString().isLength({ min: 2 }),
		check("jobTitle").isString().isLength({ min: 3 }),
		check("groupId").optional().isNumeric(),
	],
	createPerson
);

// Update Person
router.patch(
	"/update",
	[
		check("id").isNumeric(),
		check("firstName").optional().isString().isLength({ min: 2 }),
		check("lastName").optional().isString().isLength({ min: 2 }),
		check("jobTitle").optional().isString().isLength({ min: 3 }),
		check("groupId")
			.optional()
			.custom((value) => value === null || /^[0-9]+$/.test(value)),
	],
	updatePerson
);

// Delete Person
router.delete("/delete", [check("id").isNumeric()], deletePerson);

// For person get all groups above
router.get("/get-groups-above", check("id").isNumeric(), getGroupsAbove);

export default router;
