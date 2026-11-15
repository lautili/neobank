function parseProfilePatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (!keys.length || keys.some((key) => key !== "avatar_url")) return null;

  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body, "avatar_url")) {
    if (body.avatar_url === null) {
      patch.avatar_url = null;
    } else if (typeof body.avatar_url === "string") {
      const value = body.avatar_url.trim();
      if (!value || value.length > 2048) return null;
      let url;
      try {
        url = new URL(value);
      } catch {
        return null;
      }
      if (
        (url.protocol !== "http:" && url.protocol !== "https:")
        || !url.hostname
        || url.username
        || url.password
        || url.href.length > 2048
      ) {
        return null;
      }
      patch.avatar_url = url.href;
    } else {
      return null;
    }
  }

  return patch;
}

module.exports = { parseProfilePatch };
