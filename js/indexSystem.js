"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mqtt_1 = __importDefault(require("mqtt"));
const dotenv_1 = __importDefault(require("dotenv"));
const pm2_1 = __importDefault(require("pm2"));
const oberknecht_utils_1 = require("oberknecht-utils");
const systeminformation_1 = __importDefault(require("systeminformation"));
const child_process_1 = require("child_process");
const { version, repository } = require("../package.json");
const sn = (0, oberknecht_utils_1.stackName)("HA-MQTT SystemMonitor")[0];
const { MQTT_BROKER, MQTT_USER, MQTT_PASS, HA_DISCOVERY, PI_ID, PI_ID_SYSTEM: PI_ID_SYSTEM_ENV, PI_NAME_FRIENDLY, UPDATE_INTERVAL_MS, BASE_TOPIC_SYSTEM: BASE_TOPIC_ENV, STATUS_TOPIC_SYSTEM: STATUS_TOPIC_ENV, PAYLOAD_STATUS_ON: PAYLOAD_STATUS_ON_ENV, PAYLOAD_STATUS_OFF: PAYLOAD_STATUS_OFF_ENV, MONITOR_TOPIC_SYSTEM: MONITOR_TOPIC_ENV, } = dotenv_1.default.config({ quiet: true }).parsed || {};
// ================= CONFIG =================
const PI_ID_SYSTEM = PI_ID_SYSTEM_ENV ?? `${PI_ID}_system`;
const BASE_TOPIC = BASE_TOPIC_ENV ?? `pis/${PI_ID_SYSTEM}`;
const STATUS_TOPIC = STATUS_TOPIC_ENV ?? `${BASE_TOPIC}/status`;
const PAYLOAD_STATUS_ON = PAYLOAD_STATUS_ON_ENV ?? "ON";
const PAYLOAD_STATUS_OFF = PAYLOAD_STATUS_OFF_ENV ?? "OFF";
const MONITOR_TOPIC = MONITOR_TOPIC_ENV ?? `${BASE_TOPIC}/monitor`;
const COMMAND_TOPIC_UPDATE = `${BASE_TOPIC}/command/update`;
const COMMAND_TOPIC_UPDATE_FIRMWARE = `${BASE_TOPIC}/command/update_firmware`;
const UPDATE_INTERVAL = UPDATE_INTERVAL_MS
    ? parseInt(UPDATE_INTERVAL_MS)
    : 60 * 1000;
const systemSensors = {
    last_updated: {
        name: "Last Updated",
        device_class: "timestamp",
        value_template: "{{ value_json.info.timestamp }}",
        // json_attributes_template: "{{ value_json.info | tojson }}",
    },
    software_version: {
        name: "Software Version",
        value_template: "{{ value_json.info.softwareVersion }}",
        icon: "mdi:application-edit",
    },
    uptime: {
        name: "System Start Time",
        // device_class: "duration",
        // unit_of_measurement: "s",
        device_class: "timestamp",
        value_template: "{{ value_json.info.startTime }}",
        icon: "mdi:timer-sand",
    },
    cpu_speed: {
        name: "CPU Speed",
        unit_of_measurement: "GHz",
        value_template: "{{ value_json.info.cpuSpeed }}",
        icon: "mdi:cpu-64-bit",
    },
    cpu_use: {
        name: "CPU Use",
        unit_of_measurement: "%",
        value_template: "{{ value_json.info.cpuUse }}",
        icon: "mdi:cpu-64-bit",
    },
    temperature: {
        name: "CPU Temperature",
        device_class: "temperature",
        unit_of_measurement: "°C",
        value_template: "{{ value_json.info.temperature }}",
        icon: "mdi:thermometer",
    },
    memory_used: {
        name: "Memory Used",
        device_class: "data_size",
        unit_of_measurement: "GB",
        value_template: "{{ value_json.info.memoryUsed }}",
        icon: "mdi:memory",
    },
    memory_use: {
        name: "Memory Use",
        unit_of_measurement: "%",
        value_template: "{{ value_json.info.memoryUse }}",
        icon: "mdi:memory",
    },
    disk_used: {
        name: "Disk Used",
        device_class: "data_size",
        unit_of_measurement: "GB",
        value_template: "{{ value_json.info.diskUsed }}",
        icon: "mdi:sd",
    },
    disk_use: {
        name: "Disk Use",
        unit_of_measurement: "%",
        value_template: "{{ value_json.info.diskUse }}",
        icon: "mdi:sd",
    },
    network_rx: {
        name: "Network RX",
        device_class: "data_size",
        unit_of_measurement: "MB",
        value_template: "{{ value_json.info.networkRx }}",
        icon: "mdi:download-network",
    },
    network_tx: {
        name: "Network TX",
        device_class: "data_size",
        unit_of_measurement: "MB",
        value_template: "{{ value_json.info.networkTx }}",
        icon: "mdi:upload-network",
    },
    // ip_address: {
    //   name: "IP Address",
    //   value_template: "{{ value_json.info.ipAddress }}",
    //   icon: "mdi:upload-network",
    // },
    system_updates_available: {
        name: "Updates Available",
        value_template: "{{ value_json.info.systemUpdatesAvailable }}",
        icon: "mdi:package-up",
    },
    system_updates_last_check: {
        name: "Updates Last Check",
        device_class: "timestamp",
        value_template: "{{ value_json.info.systemUpdatesLastCheck }}",
        icon: "mdi:package-up",
    },
    pm2_active_process_count: {
        name: "PM2 Active Process Count",
        value_template: "{{ value_json.info.pm2ActiveProcessCount }}",
        icon: "mdi:application-cog",
    },
    pm2_unstable_restarts: {
        name: "PM2 Unstable Restarts",
        value_template: "{{ value_json.info.pm2UnstableRestarts }}",
        icon: "mdi:application-cog",
    },
    pm2_memory_use: {
        name: "PM2 Memory Used",
        device_class: "data_size",
        unit_of_measurement: "GB",
        value_template: "{{ value_json.info.pm2MemoryUsed }}",
        icon: "mdi:application-cog",
    },
    pm2_cpu_usage: {
        name: "PM2 CPU Usage",
        unit_of_measurement: "%",
        value_template: "{{ value_json.info.pm2CPUUsage }}",
        icon: "mdi:application-cog",
    },
};
let systemUpdatesLastCheck = -1;
let systemUpdatesAvailable = -1;
// =========================================
// MQTT connection
const client = mqtt_1.default.connect(MQTT_BROKER, {
    username: MQTT_USER,
    password: MQTT_PASS,
    will: {
        topic: STATUS_TOPIC,
        payload: PAYLOAD_STATUS_OFF,
        retain: true,
    },
});
client.on("connect", () => {
    (0, oberknecht_utils_1.log)(1, sn, "MQTT connected (System Monitoring)");
    client.publish(STATUS_TOPIC, PAYLOAD_STATUS_ON, { retain: true });
    publishDiscovery();
    subscribeToMessages();
    sendSystemState().catch((e) => {
        (0, oberknecht_utils_1.log)(3, sn, Error("Error sending system state:", { cause: e }));
    });
});
setInterval(() => {
    if (client.connected) {
        client.publish(STATUS_TOPIC, PAYLOAD_STATUS_ON, { retain: true });
        sendSystemState().catch((e) => {
            (0, oberknecht_utils_1.log)(3, sn, Error("Error sending system state:", { cause: e }));
        });
    }
}, UPDATE_INTERVAL);
async function sendSystemState() {
    let r = {
        info: {
            timestamp: new Date().toISOString(),
            softwareVersion: version.toString(),
            startTime: new Date(parseInt((Date.now() - systeminformation_1.default.time().uptime * 1000).toFixed(0))).toISOString(),
            cpuSpeed: -1,
            cpuUse: -1,
            temperature: -1,
            diskUsed: -1,
            diskUse: -1,
            memoryUsed: -1,
            memoryUse: -1,
            systemUpdatesAvailable: systemUpdatesAvailable <= 0 ? undefined : systemUpdatesAvailable,
            systemUpdatesLastCheck: systemUpdatesLastCheck <= 0
                ? undefined
                : new Date(systemUpdatesLastCheck).toISOString(),
            networkRx: -1,
            networkTx: -1,
            // ipAddress: undefined
            pm2ActiveProcessCount: -1,
            pm2UnstableRestarts: -1,
            pm2MemoryUsed: -1,
            pm2CPUUsage: -1,
        },
    };
    pm2_1.default.list((err, processes) => {
        if (err)
            return (0, oberknecht_utils_1.log)(3, sn, Error("Error getting PM2 process list:", { cause: err }));
        let pm2ActiveProcessCount = 0;
        let pm2UnstableRestarts = 0;
        let pm2MemoryUse = 0;
        let pm2CPUUsage = 0;
        processes.forEach((proc) => {
            if (proc.pid === undefined)
                return;
            pm2ActiveProcessCount++;
            pm2UnstableRestarts += proc.pm2_env.unstable_restarts;
            pm2MemoryUse += proc.monit.memory / 1024 / 1024 / 1024; // GB
            pm2CPUUsage += proc.monit.cpu;
        });
        r.info.pm2ActiveProcessCount = pm2ActiveProcessCount;
        r.info.pm2UnstableRestarts = pm2UnstableRestarts;
        r.info.pm2MemoryUsed = parseFloat(pm2MemoryUse.toFixed(2));
        r.info.pm2CPUUsage = parseFloat(pm2CPUUsage.toFixed(2));
    });
    const siData = await systeminformation_1.default.get({
        cpu: "speed",
        cpuTemperature: "main",
        currentLoad: "currentLoad",
        // fsSize: "used, use | mount:/",
        fsSize: "*",
        mem: "active, total, used",
    });
    r.info.cpuSpeed = siData.cpu.speed;
    r.info.cpuUse = siData.currentLoad.currentLoad;
    r.info.temperature = siData.cpuTemperature.main;
    r.info.memoryUsed = siData.mem.active / 1024 / 1024 / 1024; // in GB
    r.info.memoryUse = parseInt(((siData.mem.active / siData.mem.total) * 100).toFixed(2));
    const siDrive = siData.fsSize.filter((a) => a.mount === "/")[0];
    if (siDrive) {
        r.info.diskUsed = siDrive.used / 1024 / 1024 / 1024; // in GB
        r.info.diskUse = siDrive.use;
    }
    const siDataNetwork = await systeminformation_1.default.networkStats(await systeminformation_1.default.networkInterfaceDefault());
    r.info.networkRx = siDataNetwork[0].rx_bytes / 1024 / 1024; // in MB
    r.info.networkTx = siDataNetwork[0].tx_bytes / 1024 / 1024; // in MB
    /*
    if (systemUpdatesLastCheck < Date.now() - 6 * 60 * 60 * 1000) {
      log(0, sn, "Checking for system updates...");
      await checkForSystemUpdates()
        .then((updates: number) => {
          log(0, sn, "System updates available:", updates);
          systemUpdatesLastCheck = Date.now();
          systemUpdatesAvailable = updates;
          r.info.systemUpdatesAvailable = systemUpdatesAvailable;
          r.info.systemUpdatesLastCheck = new Date(
            systemUpdatesLastCheck
          ).toISOString();
        })
        .catch((e) => {
          log(3, sn, "System updates errored:");
          log(3, sn, Error("Error checking for system updates:", { cause: e }));
        });
    }
    */
    (0, oberknecht_utils_1.log)(0, sn, "Publishing system state:", JSON.stringify(r));
    client.publish(MONITOR_TOPIC, JSON.stringify(r));
}
async function checkForSystemUpdates() {
    return new Promise((resolve, reject) => {
        (0, child_process_1.exec)("sudo apt-get update && sudo apt-get --just-print upgrade", (error, stdout, stderr) => {
            if (error || stderr) {
                reject(error ?? stderr);
                return;
            }
            const lines = stdout.split("\n");
            let updates = 0;
            lines.forEach((line) => {
                if (line.split(" ")[1] === "upgraded,") {
                    updates = parseInt(line.split(" ")[0]);
                }
            });
            resolve(updates);
        });
    });
}
function subscribeToMessages() { }
client.on("message", (topic, message) => {
    (0, oberknecht_utils_1.log)(0, sn, "Received MQTT Message on topic", topic, ": ", message.toString());
    switch (topic) {
        case COMMAND_TOPIC_UPDATE:
            (0, oberknecht_utils_1.log)(1, sn, "Manual update requested via MQTT");
            sendSystemState().catch((e) => {
                (0, oberknecht_utils_1.log)(3, sn, Error("Error sending system state:", { cause: e }));
            });
            break;
        case COMMAND_TOPIC_UPDATE_FIRMWARE:
            (0, oberknecht_utils_1.log)(1, sn, "System upgrade requested via MQTT");
            process.exit(1);
            break;
    }
});
// ================= HOME ASSISTANT DISCOVERY =================
function publishDiscovery() {
    (0, oberknecht_utils_1.log)(0, sn, "Publishing Home Assistant MQTT Discovery");
    Object.entries({ ...systemSensors }).forEach(([name, cfg], i) => {
        const payload = {
            ...cfg,
            ...(i === 0
                ? { json_attributes_template: "{{ value_json.info | tojson }}" }
                : {}),
            state_topic: MONITOR_TOPIC,
            availability_topic: STATUS_TOPIC,
            payload_available: PAYLOAD_STATUS_ON,
            payload_not_available: PAYLOAD_STATUS_OFF,
            unique_id: `${PI_ID_SYSTEM}_${name}`,
            display_precision: 2,
            device: {
                identifiers: [PI_ID_SYSTEM],
                name: PI_NAME_FRIENDLY,
                model: "Raspberry Pi",
                manufacturer: "Raspberry Pi Foundation",
            },
        };
        client.publish(`${HA_DISCOVERY}/sensor/${PI_ID_SYSTEM}/${name}/config`, JSON.stringify(payload), { retain: true });
    });
    Object.entries({
        send_monitor_update: {
            name: "Send Monitor Update",
            command_topic: COMMAND_TOPIC_UPDATE,
            discovery_type: "button",
        },
        update_ha_mqtt_software: {
            name: "Update HA-MQTT Software",
            command_topic: COMMAND_TOPIC_UPDATE_FIRMWARE,
            // state_topic: MONITOR_TOPIC,
            // value_template: "{{ value_json.info.softwareVersion }}",
            // platform: "update",
            // discovery_type: "update",
            // release_url: repository?.url,
            discovery_type: "button",
        },
    }).forEach(([name, cfg]) => {
        const payload = {
            ...(0, oberknecht_utils_1.filterByKeys)(cfg, undefined, ["discovery_type"]),
            availability_topic: STATUS_TOPIC,
            payload_available: PAYLOAD_STATUS_ON,
            payload_not_available: PAYLOAD_STATUS_OFF,
            unique_id: `${PI_ID_SYSTEM}_${name}`,
            device: {
                identifiers: [PI_ID_SYSTEM],
                name: PI_NAME_FRIENDLY,
                model: "Raspberry Pi",
                manufacturer: "Raspberry Pi Foundation",
            },
        };
        client.publish(`${HA_DISCOVERY}/${cfg.discovery_type ?? "button"}/${PI_ID_SYSTEM}/${name}/config`, JSON.stringify(payload), { retain: false });
        client.subscribe(cfg.command_topic);
    });
}
// ================= CLEAN EXIT =================
process.on("SIGINT", () => {
    (0, oberknecht_utils_1.log)(1, sn, "Exiting, setting MQTT status to OFF");
    client.publish(STATUS_TOPIC, "OFF", { retain: true });
    process.exit();
});
