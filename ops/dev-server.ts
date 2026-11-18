import app from "../src/app";

const port = Number(process.env.PORT) || 3000;

app.listen(port, "127.0.0.1", () => {
  console.log(`Local API listening on http://127.0.0.1:${port}`);
});
