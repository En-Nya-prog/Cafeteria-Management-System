import express from "express";
import { createApp } from "./serverRuntime.js";

const app = await createApp(express);

export default app;
