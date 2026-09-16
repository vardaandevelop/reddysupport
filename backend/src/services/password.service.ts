import argon2 from "argon2";
import { env } from "../config/env.js";
export const hashPassword = (password: string) => argon2.hash(password, { type:argon2.argon2id, memoryCost:env.PASSWORD_ARGON_MEMORY_COST, timeCost:env.PASSWORD_ARGON_TIME_COST, parallelism:env.PASSWORD_ARGON_PARALLELISM });
export const verifyPassword = (hash: string, password: string) => argon2.verify(hash, password);
