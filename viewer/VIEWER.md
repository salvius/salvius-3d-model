# Salvius URDF Viewer

The viewer renders the repository's `salvius.urdf` and `meshes/` assets in a browser. It includes orbit/pan/zoom controls, sliders and drag manipulation for every movable joint, and selectable interpolated walk, wave/look-around, and finger-wiggle cycles. Enable **Drag joints** to manipulate a link directly; playback pauses when the mode is enabled, and normal camera dragging returns when the mode is disabled.

## Docker

From the repository root, build and start the viewer:

```sh
docker compose -f viewer/docker-compose.yml up --build
```

Open [http://localhost:8080](http://localhost:8080). The compose file mounts `salvius.urdf` and `meshes/` read-only, so model changes do not require rebuilding the image. For another robot, update those mounts to its URDF and mesh directory; mesh paths in the URDF should be relative to the URDF file.

## Local development

Requires Node.js 20 or newer.

```sh
cd viewer
npm install
npm run dev
```

Open [http://localhost:8080](http://localhost:8080). For a production build, run `npm run build` followed by `npm start` from `viewer/`.

## Walk cycle format

Animation files are in `public/animations/`. Keyframe times are milliseconds; revolute joint values are radians and prismatic values are meters. The viewer linearly interpolates between frames, holds omitted joints at their most recent keyframe value, and clamps the timeline to the animation duration.