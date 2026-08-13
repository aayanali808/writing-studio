/** @type {import('next').NextConfig} */
const nextConfig = {
  // `pg` uses dynamic requires; `google-auth-library` reads PEM keys through
  // node crypto. Neither survives being bundled into the server build.
  serverExternalPackages: ['pg', 'google-auth-library'],
};

export default nextConfig;
