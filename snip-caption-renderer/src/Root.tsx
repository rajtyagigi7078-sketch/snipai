import React from "react";
import { Composition } from "remotion";
import {
  CaptionComposition,
  type CaptionCompositionProps,
} from "./CaptionComposition";
import {
  CaptionOnlyComposition,
  type CaptionOnlyProps,
} from "./CaptionOnlyComposition";

const FPS = 30;

const defaultData: CaptionCompositionProps["data"] = {
  lines: [],
};

const defaultCaptionOnlyData: CaptionOnlyProps["data"] = {
  lines: [],
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
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

      <Composition
        id="SnipCaptionOnly"
        component={CaptionOnlyComposition}
        durationInFrames={60 * FPS}
        fps={FPS}
        width={1080}
        height={360}
        defaultProps={{
          data: defaultCaptionOnlyData,
          theme: "pop",
          primaryColor: "#ffffff",
          secondaryColor: "#ffff00",
          fontSize: 64,
        }}
      />
    </>
  );
};
