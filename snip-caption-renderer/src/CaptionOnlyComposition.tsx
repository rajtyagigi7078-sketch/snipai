import React from "react";
import { AbsoluteFill } from "remotion";
import {
  CaptionTheme,
  type CaptionsData,
} from "remotion-captions-themes";

export type CaptionOnlyProps = {
  data: CaptionsData;
  theme?: string;
  primaryColor?: string;
  secondaryColor?: string;
  fontSize?: number | string;
};

export const CaptionOnlyComposition: React.FC<CaptionOnlyProps> = ({
  data,
  theme = "pop",
  primaryColor = "#ffffff",
  secondaryColor = "#ffff00",
  fontSize = 64,
}) => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "transparent",
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <CaptionTheme
          data={data}
          theme={theme}
          primaryColor={primaryColor}
          secondaryColor={secondaryColor}
          fontSize={fontSize}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
