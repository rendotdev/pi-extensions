import type { DiffReviewFileInput, ReviewGroupInput } from "../../../domains/review/index.ts";
import type { JsonObject } from "../types/types.ts";

export function parseToolArguments(value: unknown): JsonObject {
  if (value === undefined) {
    return {};
  }
  const isInvalidArguments = !value || typeof value !== "object" || Array.isArray(value);
  if (isInvalidArguments) {
    throw new Error("Tool arguments must be an object.");
  }
  return value as JsonObject;
}

export function optionalString(argumentsValue: JsonObject, name: string): string | undefined {
  const value = argumentsValue[name];
  if (value === undefined) {
    return undefined;
  }
  const isInvalidValue = typeof value !== "string" || value.length === 0;
  if (isInvalidValue) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

export function requiredString(argumentsValue: JsonObject, name: string): string {
  const value = optionalString(argumentsValue, name);
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export function optionalBoolean(argumentsValue: JsonObject, name: string): boolean | undefined {
  const value = argumentsValue[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean.`);
  }
  return value;
}

export function jsonReviewFiles(value: unknown): DiffReviewFileInput[] {
  const isInvalidFiles = !Array.isArray(value) || value.length === 0;
  if (isInvalidFiles) {
    throw new Error("files must be a non-empty array.");
  }
  return value.map((entry, index) => {
    const isInvalidEntry = !entry || typeof entry !== "object";
    if (isInvalidEntry) {
      throw new Error(`files[${index}] must be an object.`);
    }
    const file = entry as JsonObject;
    return {
      location: requiredString(file, "location"),
      oldContent: requiredStringAllowEmpty(file, "oldContent"),
      newContent: requiredStringAllowEmpty(file, "newContent"),
    };
  });
}

export function optionalReviewGroups(value: unknown): ReviewGroupInput[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const isInvalidGroups = !Array.isArray(value) || value.length === 0;
  if (isInvalidGroups) {
    throw new Error("groups must be a non-empty array.");
  }
  return value.map(parseReviewGroup);
}

function parseReviewGroup(entry: unknown, index: number): ReviewGroupInput {
  const isInvalidEntry = !entry || typeof entry !== "object" || Array.isArray(entry);
  if (isInvalidEntry) {
    throw new Error(`groups[${index}] must be an object.`);
  }
  const group = entry as JsonObject;
  const extraKeys = Object.keys(group).filter((key) => key !== "title" && key !== "files");
  if (extraKeys.length > 0) {
    throw new Error(`groups[${index}] has unsupported fields: ${extraKeys.join(", ")}.`);
  }
  const files = group.files;
  if (!Array.isArray(files)) {
    throw new Error(`groups[${index}].files must be a non-empty array.`);
  }
  if (files.length === 0) {
    throw new Error(`groups[${index}].files must be a non-empty array.`);
  }
  return {
    title: requiredString(group, "title"),
    files: files.map((file, fileIndex) => {
      const isInvalidFile = typeof file !== "string" || file.length === 0;
      if (isInvalidFile) {
        throw new Error(`groups[${index}].files[${fileIndex}] must be a non-empty string.`);
      }
      return file;
    }),
  };
}

function requiredStringAllowEmpty(value: JsonObject, name: string): string {
  if (typeof value[name] !== "string") {
    throw new Error(`${name} must be a string.`);
  }
  return value[name];
}
