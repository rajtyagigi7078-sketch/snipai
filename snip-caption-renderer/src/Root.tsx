import React from "react";
import { Composition } from "remotion";
import {
  CaptionComposition,
  type CaptionCompositionProps,
} from "./CaptionComposition";

const FPS = 30;

const defaultData: CaptionCompositionProps["data"] = {
  lines: [],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="SnipCaption"
      component={CaptionComposition}
      durationInFrames={FPS}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{
        data: defaultData,
        videoSrc: "",
        theme: "pop",
        primaryColor: "#ffffff",
        secondaryColor: "#ffff00",
        fontSize: 64,
      }}
    />
  );
};
