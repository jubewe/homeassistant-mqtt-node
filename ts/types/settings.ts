export type settingsInputType = {
  nameFriendly: string;
  pin: string;
  type: "binary_sensor";
  invertLogic?: boolean;
};

export type settingsOutputType = {
  nameFriendly: string;
  pin: string;
  type: "switch";
  invertLogic?: boolean;
};

export type settingsType = {
  inputs: Record<string, settingsInputType>;
  outputs: Record<string, settingsOutputType>;
};
