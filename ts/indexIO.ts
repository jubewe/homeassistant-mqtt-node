import mqtt from "mqtt";
import { oberknechtRPIO } from "oberknecht-rpio";
import dotenv from "dotenv";
import fs from "fs";
import { log, mainPath, stackName } from "oberknecht-utils";
import { settingsType } from "./types/settings";

const sn = stackName("HA-MQTT I/O")[0];

let settings: settingsType = {
  inputs: {},
  outputs: {},
};

if (fs.existsSync(mainPath("./settings.js"))) {
  try {
    let settingsFile = JSON.parse(
      fs.readFileSync(mainPath("./settings.js"), "utf-8")
    );
  } catch (e) {
    log(2, sn, Error("Could not parse settings.js file!", { cause: e }));
  }
}

const { inputs, outputs } = settings;

const {
  MQTT_BROKER,
  MQTT_USER,
  MQTT_PASS,
  HA_DISCOVERY,
  PI_ID,
  PI_NAME_FRIENDLY,
  UPDATE_INTERVAL_MS,
  BASE_TOPIC: BASE_TOPIC_ENV,
  STATUS_TOPIC: STATUS_TOPIC_ENV,
  PAYLOAD_STATUS_ON: PAYLOAD_STATUS_ON_ENV,
  PAYLOAD_STATUS_OFF: PAYLOAD_STATUS_OFF_ENV,
  PAYLOAD_GPIO_ON: PAYLOAD_GPIO_ON_ENV,
  PAYLOAD_GPIO_OFF: PAYLOAD_GPIO_OFF_ENV,
} = dotenv.config().parsed || {};

const gpio = new oberknechtRPIO();
gpio.init();

// ================= CONFIG =================

const BASE_TOPIC = BASE_TOPIC_ENV ?? `pis/${PI_ID}`;
const STATUS_TOPIC = STATUS_TOPIC_ENV ?? `${BASE_TOPIC}/status`;
const PAYLOAD_STATUS_ON = PAYLOAD_STATUS_ON_ENV ?? "ON";
const PAYLOAD_STATUS_OFF = PAYLOAD_STATUS_OFF_ENV ?? "OFF";
const PAYLOAD_GPIO_ON = PAYLOAD_GPIO_ON_ENV ?? "1";
const PAYLOAD_GPIO_OFF = PAYLOAD_GPIO_OFF_ENV ?? "0";

const UPDATE_INTERVAL = UPDATE_INTERVAL_MS ? parseInt(UPDATE_INTERVAL_MS) : 60 * 1000;

// =========================================

// MQTT connection
const client = mqtt.connect(MQTT_BROKER, {
  username: MQTT_USER,
  password: MQTT_PASS,
  will: {
    topic: STATUS_TOPIC,
    payload: PAYLOAD_STATUS_OFF,
    retain: true,
  },
});

client.on("connect", () => {
  log(0, sn, "MQTT connected");
  client.publish(STATUS_TOPIC, PAYLOAD_STATUS_ON, { retain: true });

  publishDiscovery();
  subscribeOutputs();

  sendGPIOStates();
});

setInterval(() => {
  if (client.connected) {
    client.publish(STATUS_TOPIC, PAYLOAD_STATUS_ON, { retain: true });
  }
}, UPDATE_INTERVAL);

// ================= GPIO INPUTS =================
Object.entries(inputs).forEach(([name, cfg]) => {
  //   const gpio = new Gpio(cfg.pin, "in", "both");

  gpio.setGPIO(cfg.pin, {
    type: "input",
  });

  gpio.mock(cfg.pin, (data) => {
    log(
      0,
      sn,
      "Input changed",
      name,
      "Pin:",
      cfg.pin,
      "Value:",
      cfg.invertLogic ? (data.value === 0 ? 1 : 0) : data.value,
      "Inverted:",
      cfg.invertLogic ?? false
    );

    client.publish(
      `${BASE_TOPIC}/input/${name}/state`,
      (cfg.invertLogic ? (data.value === 0 ? 1 : 0) : data.value) === 1
        ? PAYLOAD_GPIO_ON
        : PAYLOAD_GPIO_OFF,
      {
        retain: true,
      }
    );
  });
});

function sendGPIOStates() {
  Object.entries(inputs).forEach(([name, cfg]) => {
    const value = gpio.getGPIO(cfg.pin);
    client.publish(
      `${BASE_TOPIC}/input/${name}/state`,
      (cfg.invertLogic
        ? value[cfg.pin].state === 0
          ? 1
          : 0
        : value[cfg.pin].state) === 1
        ? PAYLOAD_GPIO_ON
        : PAYLOAD_GPIO_OFF,
      {
        retain: true,
      }
    );
  });

  Object.entries(outputs).forEach(([name, cfg]) => {
    const value = gpio.getGPIO(cfg.pin);
    client.publish(
      `${BASE_TOPIC}/output/${name}/state`,
      (cfg.invertLogic
        ? value[cfg.pin].state === 0
          ? 1
          : 0
        : value[cfg.pin].state) === 1
        ? PAYLOAD_GPIO_ON
        : PAYLOAD_GPIO_OFF,
      {
        retain: true,
      }
    );
  });
}

// ================= GPIO OUTPUTS =================
const outputGpios = {};

Object.entries(outputs).forEach(([name, cfg]) => {
  outputGpios[name] = { pin: cfg.pin, cfg: cfg };
});

function subscribeOutputs() {
  client.subscribe(`${BASE_TOPIC}/output/+/set`);
  client.subscribe(`${BASE_TOPIC}/publishdiscovery`);
}

client.on("message", (topic, message) => {
  log(0, sn, "Received MQTT Message on topic", topic, ": ", message.toString());
  const matchSetOutput = topic.match(/output\/(.+)\/set$/);
  const matchLoad = topic.match(/publishdiscovery$/);

  if (matchSetOutput) {
    const name = matchSetOutput[1];
    if (!outputGpios[name]) return;

    const cfg = outputGpios[name].cfg;

    const value = message.toString() === PAYLOAD_GPIO_ON ? 1 : 0;
    //   outputGpios[name].writeSync(value);
    log(
      0,
      sn,
      "Setting output",
      name,
      "Pin:",
      outputGpios[name].pin,
      "to",
      cfg.invertLogic ? (value === 0 ? 1 : 0) : value,
      "Inverted: ",
      cfg.invertLogic ?? false
    );

    gpio.setGPIO(outputGpios[name].pin, {
      value: cfg.invertLogic ? (value === 0 ? 1 : 0) : value,
      type: "output",
    });

    client.publish(`${BASE_TOPIC}/output/${name}/state`, value.toString(), {
      retain: true,
    });
  }

  if (matchLoad) {
    publishDiscovery();
  }
});

// ================= HOME ASSISTANT DISCOVERY =================
function publishDiscovery() {
  console.log("Publishing Home Assistant MQTT Discovery");
  // Inputs
  Object.entries(inputs).forEach(([name, cfg]) => {
    const payload = {
      name: cfg?.nameFriendly ?? `${PI_ID} ${name}`,
      state_topic: `${BASE_TOPIC}/input/${name}/state`,
      // device_class: "opening",
      payload_on: PAYLOAD_GPIO_ON,
      payload_off: PAYLOAD_GPIO_OFF,
      unique_id: `${PI_ID}_${name}`,
      device: {
        identifiers: [PI_ID],
        name: PI_NAME_FRIENDLY,
        model: "Raspberry Pi",
        manufacturer: "Raspberry Pi Foundation",
      },
    };

    client.publish(
      `${HA_DISCOVERY}/binary_sensor/${PI_ID}/${name}/config`,
      JSON.stringify(payload),
      { retain: true }
    );
  });

  // Outputs
  Object.entries(outputs).forEach(([name, cfg]) => {
    const payload = {
      name: cfg?.nameFriendly ?? `${PI_ID} ${name}`,
      command_topic: `${BASE_TOPIC}/output/${name}/set`,
      state_topic: `${BASE_TOPIC}/output/${name}/state`,
      payload_on: PAYLOAD_GPIO_ON,
      payload_off: PAYLOAD_GPIO_OFF,
      unique_id: `${PI_ID}_${name}`,
      device: {
        identifiers: [PI_ID],
      },
    };

    client.publish(
      `${HA_DISCOVERY}/switch/${PI_ID}/${name}/config`,
      JSON.stringify(payload),
      { retain: true }
    );
  });
}

// ================= CLEAN EXIT =================
process.on("SIGINT", () => {
  Object.values(inputs).forEach((pin) => {
    gpio.unMock(pin.pin, () => {});
  });

  process.exit();
});
