const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const routes = require("./routes");
const config = require("./config/environment");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", routes);

const PORT = config.port;

app.listen(PORT, () => {
  console.log(`Worker server is running on port ${PORT}`);
});

module.exports = app;
