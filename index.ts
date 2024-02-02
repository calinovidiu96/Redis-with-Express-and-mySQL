import express, { Express, Request, Response, NextFunction } from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";

import personsRoutes from "./routes/persons-routes";
import groupsRoutes from "./routes/groups-routes";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

app.get("/", (req: Request, res: Response) => {
	res.send("Express + TypeScript Server");
});

app.use("/persons", personsRoutes);
app.use("/groups", groupsRoutes);

// Error handler middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
	console.error(err.stack);
	res.status(500).send("Something went wrong. Please try again later.");
});

app.listen(port, () => {
	console.log(`[server]: Server is running at http://localhost:${port}`);
});
