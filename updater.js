module.exports = async (calledScript) => {
  const { exec } = require("child_process");

  console.log("Homeassistant MQTT updater called");

  const logLevel = process.env["HA_MQTT_LOG_LEVEL"] || 0;

  if (logLevel >= 1) console.log("Installing npm packages...");

  await new Promise((resolve, reject) => {
    exec("npm install", (error, stdout, stderr) => {
      if (error) {
        console.error(`Error during NPM install: ${error.message}`);
        return resolve();
      }
      if (stderr) {
        console.error(`NPM install stderr: ${stderr}`);
        return resolve();
      }

      const npmUptodate = stdout.split("\n")[1].startsWith("up to date");

      if (logLevel >= 1)
        console.log(`NPM install complete: ${stdout.split("\n")[1]}`);

      if (!npmUptodate) {
        if (logLevel >= 1) console.log("Restarting to apply updates...");
        process.exit(1);
      }

      return resolve();
    });
  });

  if (logLevel >= 1) console.log("Pulling latest code from Git...");

  const { simpleGit } = require("simple-git");

  const git = simpleGit();
  await git
    .fetch(["origin"], (e) => {
      return new Promise((resolve, reject) => {
        if (e) {
          console.error(
            Error("Could not update from remote GitHub Repository", {
              cause: e,
            })
          );

          return resolve(0);
        }

        git.diff(["master", "origin/master"], (err, d) => {
          if (err) {
            console.error(
              Error("Could not update from remote GitHub Repository (2)", {
                cause: err,
              })
            );

            return resolve(0);
          }

          if (!d) {
            if (logLevel >= 1)
              console.log("No changes detected on remote GitHub Repo");
            return resolve(1);
          }

          if (logLevel >= 1)
            console.log(
              "Changes on remote GitHub Repo detected, pulling changes..."
            );

          git.pull("origin", "master", (pullErr, update) => {
            if (pullErr) {
              console.error(
                Error("Could not update from remote GitHub Repository (3)", {
                  cause: pullErr,
                })
              );

              return resolve(0);
            }

            if (logLevel >= 1) console.log("GitHub Update complete");
            if (logLevel >= 2)
              console.log(
                "Detailed update info:",
                JSON.stringify(update, null, 2)
              );

            return resolve(1);
          });
        });
      });
    })
    .then((r) => {
      if (r === 1) {
        if (logLevel >= 1) console.log("Restarting to apply GitHub updates...");
        process.exit(0);
      }
    });

  console.log("Updates complete, attempting to start script...");

  switch (calledScript) {
    case "":
      break;

    case "io":
      require("./js/indexIO.js");
      break;

    case "system":
      require("./js/indexSystem.js");
      break;

    default:
      console.error("Unknown script called:", calledScript);
  }
};
