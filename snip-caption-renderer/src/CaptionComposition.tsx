import React from "react";
import { AbsoluteFill, OffthreadVideo } from "remotion";
import {
  CaptionTheme,
  type CaptionsData,
} from "remotion-captions-themes";

export type CaptionCompositionProps = {
  data: CaptionsData;
  videoSrc: string;
  theme?: string;
  primaryColor?: string;
  secondaryColor?: string;
  fontSize?: number | string;
};

export const CaptionComposition: React.FC<CaptionCompositionProps> = ({
  data,
  videoSrc,
  theme = "pop",
  primaryColor = "#ffffff",
  secondaryColor = "#ffff00",
  fontSize = 64,
}) => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "black",
        overflow: "hidden",
      }}
    >
      <OffthreadVideo
        src={videoSrc}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />

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
