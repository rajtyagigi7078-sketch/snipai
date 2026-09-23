import React, {
  useEffect,
  useRef,
  useState,
} from "react";

import { Player } from "@remotion/player";
import { AbsoluteFill } from "remotion";

import {
  CaptionTheme,
  type CaptionsData,
} from "remotion-captions-themes";

type Props = {
  theme: string;
};

const previewData: CaptionsData = {
  lines: [
    {
      words: [
        { text: "THIS", start: 0.15, end: 0.65 },
        { text: "IS", start: 0.7, end: 1.05 },
        { text: "SNIP", start: 1.1, end: 1.8 },
        { text: "AI", start: 1.85, end: 2.35 },
      ],
    },
  ],
};

const PreviewComposition: React.FC<Props> = ({
  theme,
}) => (
  <AbsoluteFill
    style={{
      background:
        "linear-gradient(145deg, #15161d, #08090d)",
      overflow: "hidden",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <CaptionTheme
        data={previewData}
        theme={theme}
        primaryColor="#ffffff"
        secondaryColor="#ffff00"
        fontSize={80}
      />
    </div>
  </AbsoluteFill>
);

export default function CaptionThemePreview({
  theme,
}: Props) {
  const containerRef =
    useRef<HTMLDivElement | null>(null);

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = containerRef.current;

    if (!element) {
      return;
    }

    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];

        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      {
        root: null,
        rootMargin: "200px",
        threshold: 0.01,
      },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background:
          "linear-gradient(145deg, #15161d, #08090d)",
      }}
    >
      {visible ? (
        <Player
          component={PreviewComposition}
          inputProps={{ theme }}
          durationInFrames={90}
          fps={30}
          compositionWidth={1080}
          compositionHeight={1080}
          controls={false}
          autoPlay
          loop
          style={{
            width: "100%",
            height: "100%",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#777",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: 0.5,
          }}
        >
          Loading preview…
        </div>
      )}
    </div>
  );
}
