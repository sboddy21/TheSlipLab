export default function memberDataMiddleware(request) {
  const incoming = new URL(request.url);
  const file = decodeURIComponent(incoming.pathname.slice("/data/".length));
  const destination = new URL("/api/member-data", incoming.origin);
  destination.searchParams.set("file", file);
  return Response.redirect(destination, 307);
}

export const config = {
  matcher: "/data/:path*"
};
