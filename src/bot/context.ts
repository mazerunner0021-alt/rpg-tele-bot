import type { Context, SessionFlavor } from "grammy";
import type { SessionData } from "./sessionTypes";

export type MyContext = Context & SessionFlavor<SessionData>;
