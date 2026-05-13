import app from "../api/index";

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
  console.log(`Local API listening on http://localhost:${port}`);
});
