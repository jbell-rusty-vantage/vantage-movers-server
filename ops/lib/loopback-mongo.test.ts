import assert from "node:assert/strict";
import { test } from "node:test";
import { isLoopbackMongoUri } from "./loopback-mongo";

test("only all-loopback, non-SRV Mongo URIs count as loopback", () => {
  for (const uri of ["mongodb://127.0.0.1:27189/?replicaSet=csi01", "mongodb://localhost:27017", "mongodb://u:p@127.0.0.1:1,localhost:2/db?replicaSet=x"])
    assert.equal(isLoopbackMongoUri(uri), true, uri);
  for (const uri of [
    "mongodb+srv://cluster0.example.mongodb.net/?retryWrites=true",
    "mongodb://127.0.0.1:27189,db.example.com:27017/?replicaSet=rs",
    "mongodb://127.0.0.2:27017",
    "mongodb://localhost.example.com:27017",
    "mongodb://127.0.0.1.nip.io:27017",
    "not a uri",
    "",
  ])
    assert.equal(isLoopbackMongoUri(uri), false, uri);
});
