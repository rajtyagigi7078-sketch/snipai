import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { InternalThemeProps } from "../types";

export const PopTheme: React.FC<InternalThemeProps> = ({
  primaryColor,
  secondaryColor,
  data,
  fontSize,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = frame / fps;

  const lines = data.lines;

  if (!lines.length) {
    return null;
  }

  // Find the active caption line.
  // Caption lines are chronological, so stop as soon as the
  // current frame falls inside a line or before the next line.
  let activeLine = lines[0];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line.words.length) {
      continue;
    }

    const lineStart = line.words[0].start;
    const lineEnd = line.words[line.words.length - 1].end;

    if (time < lineStart) {
      break;
    }

    activeLine = line;

    if (time <= lineEnd) {
      break;
    }
  }

  if (!activeLine.words.length) {
    return null;
  }

  const size =
    typeof fontSize === "number"
      ? `${fontSize}px`
      : (fontSize ?? "4.5rem");

  // Only the currently spoken word needs the spring calculation.
  // Previously every visible word called spring() on every frame.
  let activeWordIndex = -1;

  for (let i = 0; i < activeLine.words.length; i++) {
    const word = activeLine.words[i];

    if (time >= word.start && time < word.end) {
      activeWordIndex = i;
      break;
    }
  }

  const activeWord =
    activeWordIndex >= 0 ? activeLine.words[activeWordIndex] : null;

  const activeWordStartFrame = activeWord
    ? Math.round(activeWord.start * fps)
    : 0;

  const activeScale = activeWord
    ? spring({
        frame: frame - activeWordStartFrame,
        fps,
        config: {
          damping: 10,
          mass: 0.4,
          stiffness: 150,
        },
      })
    : 0;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: "15px 25px",
        fontSize: size,
        fontWeight: 900,
        fontFamily: "'Outfit', sans-serif",
        textAlign: "center",
        padding: "20px 40px",
        textShadow: "2px 2px 10px rgba(0, 0, 0, 0.5)",
        width: "100%",
        height: "100%",
      }}
    >
      {activeLine.words.map((word, index) => {
        const isActive = index === activeWordIndex;

        const color = isActive ? secondaryColor : primaryColor;

        const transform = isActive
          ? `scale(${1 + activeScale * 0.2})`
          : "scale(1)";

        const opacity = isActive ? 1 : 0.6;

        return (
          <span
            key={index}
            style={{
              color,
              transform,
              opacity,
              display: "inline-block",
              transition:
                "transform 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275), color 0.1s ease",
            }}
          >
            {word.text}
          </span>
        );
      })}
    </div>
  );
};
