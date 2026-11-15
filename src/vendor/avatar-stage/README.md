# Avatar stage

`stage.js` is Hearth AI's avatar stage (Dragongamer9/hearth-ai, `src/stage/stage.js`, built with
`npm run bundle` there), copied as built. It draws a 3D VRM model with three.js and @pixiv/three-vrm, or a Live2D
model with PixiJS and pixi-live2d-display, and gives both the same controls (moods, idle breathing, blinking, mouth
shapes from the voice). Bundled libraries, all MIT: three.js, @pixiv/three-vrm, pixi.js, @pixi/unsafe-eval,
pixi-live2d-display. Live2D's Cubism Core isn't included: it's downloaded from Live2D's own site the first time you
load a Live2D model, and kept on this PC.
