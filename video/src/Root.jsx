import React from "react";
import { Composition } from "remotion";
import { DailyMlbRundown } from "./Rundown.jsx";

export const Root = () => <Composition id="DailyMlbRundown" component={DailyMlbRundown} width={1920} height={1080} fps={30} durationInFrames={10200}
  calculateMetadata={({ props }) => ({ durationInFrames: Math.round(props.narrationSegments.reduce((n, s) => n + s.durationSeconds, 0) * props.fps), width: props.width, height: props.height, fps: props.fps })} />;
