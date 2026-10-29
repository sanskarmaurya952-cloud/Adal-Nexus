export function CosmicBackground() {
  return (
    <div className="cosmic-backdrop" aria-hidden="true">
      {/* Dynamic CSS Ambient Glow Orbs */}
      <div className="ambient-orb orb-primary" />
      <div className="ambient-orb orb-secondary" />
      <div className="ambient-orb orb-cyan" />
      <div className="ambient-orb orb-reflection" />

      {/* Pure SVG Vector Celestial & Mountain Artwork */}
      <svg
        className="cosmic-svg"
        viewBox="0 0 1920 1080"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          {/* Sky Gradient */}
          <linearGradient id="skyGrad" x1="960" y1="0" x2="960" y2="1080" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#040510" />
            <stop offset="35%" stopColor="#080a22" />
            <stop offset="65%" stopColor="#120e34" />
            <stop offset="85%" stopColor="#0d0926" />
            <stop offset="100%" stopColor="#04040d" />
          </linearGradient>

          {/* Planet Radial Glow */}
          <radialGradient id="planetGrad" cx="0.4" cy="0.4" r="0.6">
            <stop offset="0%" stopColor="#c084fc" stopOpacity="0.9" />
            <stop offset="40%" stopColor="#7e22ce" stopOpacity="0.8" />
            <stop offset="75%" stopColor="#3b0764" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#090518" stopOpacity="1" />
          </radialGradient>

          {/* Planet Ring Gradient */}
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.1" />
            <stop offset="30%" stopColor="#c084fc" stopOpacity="0.6" />
            <stop offset="70%" stopColor="#a855f7" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.05" />
          </linearGradient>

          {/* Moon Gradient */}
          <radialGradient id="moonGrad" cx="0.35" cy="0.35" r="0.65">
            <stop offset="0%" stopColor="#e9d5ff" />
            <stop offset="60%" stopColor="#9333ea" />
            <stop offset="100%" stopColor="#1e1b4b" />
          </radialGradient>

          {/* Distant Mountains Gradient */}
          <linearGradient id="farMountainGrad" x1="960" y1="360" x2="960" y2="720" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#2e1065" stopOpacity="0.65" />
            <stop offset="50%" stopColor="#1e1145" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#0d0a27" stopOpacity="0.95" />
          </linearGradient>

          {/* Mid Mountains Gradient */}
          <linearGradient id="midMountainGrad" x1="960" y1="420" x2="960" y2="760" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1c1340" />
            <stop offset="40%" stopColor="#110d2c" />
            <stop offset="100%" stopColor="#070617" />
          </linearGradient>

          {/* Near Mountains Gradient */}
          <linearGradient id="nearMountainGrad" x1="960" y1="480" x2="960" y2="820" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#151033" />
            <stop offset="60%" stopColor="#0a081e" />
            <stop offset="100%" stopColor="#050410" />
          </linearGradient>

          {/* Water Surface Gradient */}
          <linearGradient id="waterGrad" x1="960" y1="720" x2="960" y2="1080" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0e0a29" stopOpacity="0.9" />
            <stop offset="25%" stopColor="#170d38" stopOpacity="0.75" />
            <stop offset="60%" stopColor="#09071c" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#03030a" stopOpacity="0.98" />
          </linearGradient>

          {/* Neon Sphere Glowing Gradients */}
          <radialGradient id="neonOrb1" cx="0.4" cy="0.4" r="0.6">
            <stop offset="0%" stopColor="#f3e8ff" />
            <stop offset="35%" stopColor="#c084fc" stopOpacity="0.8" />
            <stop offset="70%" stopColor="#7e22ce" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>

          <radialGradient id="neonOrb2" cx="0.4" cy="0.4" r="0.6">
            <stop offset="0%" stopColor="#cffafe" />
            <stop offset="30%" stopColor="#38bdf8" stopOpacity="0.8" />
            <stop offset="65%" stopColor="#0369a1" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Base Sky */}
        <rect width="1920" height="1080" fill="url(#skyGrad)" />

        {/* Starfield Particles */}
        <g opacity="0.75">
          <circle cx="120" cy="80" r="1" fill="#fff" opacity="0.8" />
          <circle cx="280" cy="140" r="1.5" fill="#e9d5ff" opacity="0.9" />
          <circle cx="450" cy="90" r="1" fill="#fff" opacity="0.6" />
          <circle cx="620" cy="160" r="1.2" fill="#c084fc" opacity="0.85" />
          <circle cx="780" cy="70" r="1" fill="#fff" opacity="0.7" />
          <circle cx="950" cy="130" r="1.5" fill="#38bdf8" opacity="0.8" />
          <circle cx="1120" cy="95" r="1" fill="#fff" opacity="0.5" />
          <circle cx="1300" cy="170" r="1.3" fill="#e9d5ff" opacity="0.75" />
          <circle cx="1480" cy="85" r="1.5" fill="#fff" opacity="0.9" />
          <circle cx="1650" cy="150" r="1" fill="#c084fc" opacity="0.6" />
          <circle cx="1820" cy="110" r="1.4" fill="#38bdf8" opacity="0.8" />
          <circle cx="200" cy="220" r="1" fill="#fff" opacity="0.5" />
          <circle cx="360" cy="280" r="1.2" fill="#fff" opacity="0.7" />
          <circle cx="580" cy="240" r="1" fill="#e9d5ff" opacity="0.6" />
          <circle cx="840" cy="260" r="1.4" fill="#fff" opacity="0.8" />
          <circle cx="1060" cy="230" r="1" fill="#c084fc" opacity="0.65" />
          <circle cx="1240" cy="290" r="1.5" fill="#fff" opacity="0.85" />
          <circle cx="1700" cy="240" r="1.2" fill="#fff" opacity="0.7" />
        </g>

        {/* Large Celestial Planet (Upper Right) */}
        <g transform="translate(1520, 290)">
          {/* Atmospheric Halo */}
          <circle cx="0" cy="0" r="185" fill="#a855f7" opacity="0.12" filter="blur(30px)" />
          {/* Main Planet Body */}
          <circle cx="0" cy="0" r="140" fill="url(#planetGrad)" />
          {/* Soft Planet Shadow / Dark Side */}
          <path
            d="M 0 -140 A 140 140 0 0 1 140 0 A 140 140 0 0 1 0 140 A 140 140 0 0 0 0 -140"
            fill="#030208"
            opacity="0.6"
          />
          {/* Planetary Ring */}
          <ellipse
            cx="0"
            cy="0"
            rx="240"
            ry="45"
            transform="rotate(-22)"
            stroke="url(#ringGrad)"
            strokeWidth="8"
            fill="none"
            opacity="0.85"
          />
        </g>

        {/* Small Companion Moon */}
        <g transform="translate(1710, 360)">
          <circle cx="0" cy="0" r="30" fill="#38bdf8" opacity="0.15" filter="blur(10px)" />
          <circle cx="0" cy="0" r="22" fill="url(#moonGrad)" />
          <path d="M 0 -22 A 22 22 0 0 1 22 0 A 22 22 0 0 1 0 22 A 22 22 0 0 0 0 -22" fill="#04030d" opacity="0.7" />
        </g>

        {/* Far Distant Mountain Silhouettes */}
        <path
          d="M0 640 L120 540 L260 590 L380 480 L520 560 L680 430 L840 540 L980 470 L1120 550 L1260 440 L1420 530 L1560 460 L1720 520 L1840 470 L1920 510 L1920 740 L0 740 Z"
          fill="url(#farMountainGrad)"
        />

        {/* Mid Mountain Range Silhouette */}
        <path
          d="M0 680 L90 600 L210 520 L340 620 L480 490 L610 580 L760 510 L920 610 L1080 500 L1220 590 L1360 480 L1500 570 L1660 510 L1790 590 L1920 540 L1920 780 L0 780 Z"
          fill="url(#midMountainGrad)"
        />

        {/* Near Foreground Peaks & Ridge Line */}
        <path
          d="M0 720 L140 610 L280 670 L420 560 L560 650 L710 580 L880 670 L1040 590 L1210 680 L1390 570 L1540 650 L1710 590 L1860 670 L1920 630 L1920 840 L0 840 Z"
          fill="url(#nearMountainGrad)"
        />

        {/* Horizon Lake Water Body */}
        <rect x="0" y="710" width="1920" height="370" fill="url(#waterGrad)" />

        {/* Mountain Reflections in Water */}
        <g opacity="0.35" filter="blur(8px)">
          <path
            d="M0 720 L140 830 L280 770 L420 880 L560 790 L710 860 L880 770 L1040 850 L1210 760 L1390 870 L1540 790 L1710 850 L1860 770 L1920 810 L1920 720 Z"
            fill="#1e1045"
          />
        </g>

        {/* Purple Glowing Shoreline Laser/Light Lines */}
        <path
          d="M 60 775 Q 400 740 960 740 T 1860 775"
          stroke="#c084fc"
          strokeWidth="2.5"
          fill="none"
          opacity="0.65"
          filter="drop-shadow(0 0 10px #a855f7)"
        />
        <path
          d="M 120 795 Q 600 770 1100 770 T 1800 795"
          stroke="#a855f7"
          strokeWidth="1.5"
          fill="none"
          opacity="0.45"
        />
        <path
          d="M 220 830 Q 750 810 1200 810 T 1700 830"
          stroke="#38bdf8"
          strokeWidth="1"
          fill="none"
          opacity="0.35"
        />

        {/* Left Glowing Floating Sphere */}
        <g transform="translate(180, 720)">
          <circle cx="0" cy="0" r="90" fill="#a855f7" opacity="0.2" filter="blur(25px)" />
          <circle cx="0" cy="0" r="55" fill="url(#neonOrb1)" />
          <ellipse cx="0" cy="65" rx="70" ry="12" fill="#c084fc" opacity="0.25" filter="blur(8px)" />
        </g>

        {/* Right Glowing Floating Sphere */}
        <g transform="translate(1760, 750)">
          <circle cx="0" cy="0" r="100" fill="#38bdf8" opacity="0.18" filter="blur(25px)" />
          <circle cx="0" cy="0" r="65" fill="url(#neonOrb2)" />
          <ellipse cx="0" cy="75" rx="80" ry="14" fill="#38bdf8" opacity="0.2" filter="blur(8px)" />
        </g>
      </svg>
    </div>
  );
}
