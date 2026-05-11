import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const SheetTabSchema = new Schema(
  {
    spreadsheetId: {
      type: String,
      required: true,
      index: true,
    },
    companySite: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    tabName: {
      type: String,
      required: true,
      trim: true,
    },
    tabType: {
      type: String,
      required: true,
      enum: ["LEADS", "CALLS"],
    },
    googleSheetId: {
      type: Number,
    },
  },
  {
    timestamps: true,
  },
);

SheetTabSchema.index(
  { spreadsheetId: 1, companySite: 1, tabType: 1 },
  { unique: true },
);

export type SheetTabDocument = InferSchemaType<typeof SheetTabSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const SheetTab: Model<SheetTabDocument> =
  mongoose.models.SheetTab ?? mongoose.model<SheetTabDocument>("SheetTab", SheetTabSchema);
