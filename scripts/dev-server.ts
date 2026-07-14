import app from "../src/app";

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`Local API listening on http://localhost:${port}`);
});
