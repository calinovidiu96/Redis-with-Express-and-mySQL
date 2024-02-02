import { Router } from "express";
import { check } from "express-validator";

import {
	getGroups,
	createGroup,
	updateGroup,
	deleteGroup,
} from "./../controllers/groups-controller";

const router = Router();

// Get Group (or all groups if no id)
router.get("/", check("id").optional().isNumeric(), getGroups);

// Create Group
router.post(
	"/create",
	[
		check("groupName").isString().isLength({ min: 2 }),
		check("parentGroupId").optional().isNumeric(),
	],
	createGroup
);

// Update Group
router.patch(
	"/update",
	[
		check("id").isNumeric(),
		check("groupName").optional().isString().isLength({ min: 2 }),
		check("parentGroupId")
			.optional()
			.custom((value) => value === null || /^[0-9]+$/.test(value)),
	],
	updateGroup
);

// Delete Person
router.delete(
	"/delete",
	[
		check("id").isNumeric(),
		check("jobTitle").optional().isString().isLength({ min: 2 }),
		check("firstName").optional().isString().isLength({ min: 2 }),
	],
	deleteGroup
);

export default router;
