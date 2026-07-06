import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // El CSV del padrón EPS viaja como texto en el body de la server action
      // (default 1 MB). 8 MB cubre padrones grandes con margen.
      bodySizeLimit: "8mb",
    },
  },
};

export default nextConfig;
