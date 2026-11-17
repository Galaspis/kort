import Svg, { Ellipse, G, Path, Rect } from "react-native-svg";

/**
 * A steak in a pan, seen from the side and cut through: the crust, the grey
 * overcooked band under it and the pink middle. Drawn from numbers so the
 * browning lesson can show exactly what a temperature does. SVG coordinates
 * are not mirrored in right-to-left layouts, so the picture is the same everywhere.
 */
export interface SteakLook {
  /** Colour of the outside. */
  crust: string;
  /** 0..1: how thick the grey band under the crust is (longer in the pan = thicker). */
  greyBand: number;
  /** Colour of the middle. */
  center: string;
  /** 0..1: steam rising (water leaving the surface). */
  steam: number;
  /** 0..1: smoke (fat past its smoke point). */
  smoke: number;
  /** 0..1: liquid pooling in the pan. */
  liquid: number;
  /** Dark burnt specks on the pan bottom. */
  burntBits?: boolean;
  /** The steak is torn where it stuck to the pan. */
  torn?: boolean;
}

function Wisp({ x, color, opacity, tall }: { x: number; color: string; opacity: number; tall: number }) {
  const top = 62 - tall;
  return (
    <Path
      d={`M ${x} 62 C ${x - 9} ${62 - tall * 0.33}, ${x + 9} ${62 - tall * 0.66}, ${x} ${top}`}
      stroke={color}
      strokeWidth={3}
      strokeLinecap="round"
      fill="none"
      opacity={opacity}
    />
  );
}

export function SteakArt({ look, width = 300, pan = "#3A3431" }: { look: SteakLook; width?: number; pan?: string }) {
  const height = (width * 150) / 300;
  const band = 3 + look.greyBand * 15;
  return (
    <Svg width={width} height={height} viewBox="0 0 300 150">
      {/* steam: pale and tall; smoke: dark and taller */}
      {look.steam > 0.05 ? (
        <G>
          <Wisp x={105} color="#B9C4CC" opacity={0.25 + look.steam * 0.6} tall={18 + look.steam * 34} />
          <Wisp x={150} color="#B9C4CC" opacity={0.25 + look.steam * 0.6} tall={24 + look.steam * 38} />
          <Wisp x={195} color="#B9C4CC" opacity={0.25 + look.steam * 0.6} tall={18 + look.steam * 34} />
        </G>
      ) : null}
      {look.smoke > 0.05 ? (
        <G>
          <Wisp x={90} color="#5E5650" opacity={0.3 + look.smoke * 0.6} tall={26 + look.smoke * 34} />
          <Wisp x={128} color="#5E5650" opacity={0.3 + look.smoke * 0.6} tall={30 + look.smoke * 30} />
          <Wisp x={172} color="#5E5650" opacity={0.3 + look.smoke * 0.6} tall={30 + look.smoke * 30} />
          <Wisp x={210} color="#5E5650" opacity={0.3 + look.smoke * 0.6} tall={26 + look.smoke * 34} />
        </G>
      ) : null}

      {/* the pan: body, handle */}
      <Rect x={250} y={112} width={46} height={9} rx={4.5} fill={pan} />
      <Path d="M 34 106 L 266 106 L 256 136 Q 254 142 246 142 L 54 142 Q 46 142 44 136 Z" fill={pan} />
      <Rect x={30} y={102} width={240} height={7} rx={3.5} fill={pan} />

      {/* liquid pooling around the meat */}
      {look.liquid > 0.05 ? (
        <Ellipse cx={150} cy={104} rx={70 + look.liquid * 34} ry={3 + look.liquid * 4} fill="#B7A99B" opacity={0.55 + look.liquid * 0.35} />
      ) : null}
      {look.burntBits ? (
        <G fill="#17110E">
          <Ellipse cx={62} cy={103} rx={5} ry={2} />
          <Ellipse cx={80} cy={104} rx={3} ry={1.5} />
          <Ellipse cx={226} cy={103} rx={6} ry={2} />
          <Ellipse cx={243} cy={104} rx={3} ry={1.5} />
        </G>
      ) : null}

      {/* the steak, cut through: crust → grey band → middle */}
      <Rect x={84} y={66} width={132} height={38} rx={13} fill={look.crust} />
      <Rect x={88} y={70} width={124} height={30} rx={10} fill="#8E857D" />
      <Rect x={88 + band} y={70 + Math.min(band, 12) * 0.9} width={124 - band * 2} height={30 - Math.min(band, 12) * 1.8} rx={7} fill={look.center} />
      {look.torn ? <Path d="M 96 104 L 104 97 L 112 104 L 121 96 L 130 104 Z" fill={pan} /> : null}
    </Svg>
  );
}
