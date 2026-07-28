import { z } from "zod";

export const projectIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, "Project ID contains unsupported characters.");

export const revisionIdSchema = z
  .string()
  .trim()
  .regex(
    /^revision-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    "Revision ID is invalid.",
  );

export const attemptIdSchema = z
  .string()
  .trim()
  .regex(
    /^attempt-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    "Attempt ID is invalid.",
  );
