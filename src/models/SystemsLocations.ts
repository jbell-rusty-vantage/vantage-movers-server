import mongoose, { Schema, type Model } from "mongoose";

/**
 * `systems_locations` — the Systems tab's "Where things live" list (doc 11b, R1). Runtime configuration, not env:
 * a domain cut-over is an Owner edit, never a redeploy. One document (`key: "locations"`), seeded on first read
 * from `services/systems/locations.ts`, moved only by an Owner PATCH that compares `revision` and writes an
 * `operations_registry_changes` row in the same transaction (Setup › Change history). The Master Sheet links are
 * not stored here; they are built from the sheet id env names at read time.
 */
export const SYSTEMS_LOCATIONS_DOCUMENT_KEY = "locations" as const;

export type SystemsLocationEntry = {
  label: string;
  url: string;
  note: string | null;
  /** Partner landing pages only: paths shown as chips that each open `url + path`. */
  paths: string[];
  code_url: string | null;
  /** For example "personal account" on the extension's code link. */
  code_note: string | null;
  host_url: string | null;
  logs_url: string | null;
};

export type SystemsLocationsDocument = {
  _id: mongoose.Types.ObjectId;
  key: typeof SYSTEMS_LOCATIONS_DOCUMENT_KEY;
  revision: number;
  entries: Record<string, SystemsLocationEntry>;
  updated_by: string | null;
  updated_at: Date;
};

const SystemsLocationsSchema = new Schema(
  {
    key: { type: String, required: true, enum: [SYSTEMS_LOCATIONS_DOCUMENT_KEY] },
    revision: { type: Number, required: true, min: 1 },
    entries: { type: Schema.Types.Mixed, required: true },
    updated_by: { type: String, default: null },
    updated_at: { type: Date, required: true, default: Date.now },
  },
  { collection: "systems_locations", versionKey: false, minimize: false },
);

SystemsLocationsSchema.index({ key: 1 }, { unique: true, name: "systems_locations_key_unique" });

export const SystemsLocations: Model<SystemsLocationsDocument> =
  (mongoose.models.SystemsLocations as Model<SystemsLocationsDocument> | undefined) ??
  mongoose.model<SystemsLocationsDocument>("SystemsLocations", SystemsLocationsSchema);
