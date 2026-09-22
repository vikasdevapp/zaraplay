self.addEventListener("push", (event) => {
  let data = { title: "Zara Plays", body: "You have a new notification." };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // ignore malformed payloads
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/logo.jpeg",
      badge: "/logo.jpeg",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/dashboard"));
});
