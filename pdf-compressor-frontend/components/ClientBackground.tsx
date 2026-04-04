"use client";

import dynamic from "next/dynamic";

// Dynamically import the grid only on the client side
const ShapeGrid = dynamic(() => import("./ShapeGrid"), { 
  ssr: false 
});

export default function ClientBackground() {
  return (
    <div className="background-grid">
      <ShapeGrid 
        speed={0.22}
        squareSize={30}
        direction="diagonal"
        borderColor="rgba(117, 151, 199, 0.3)"
        hoverFillColor="rgba(138, 170, 214, 0.16)"
        shape="square"
        hoverTrailAmount={3}
      />
    </div>
  );
}