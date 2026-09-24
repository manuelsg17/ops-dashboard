// Conserva la consulta y el ancla al redirigir (p. ej. ?ui=... o #...).
(function () {
  var destino = "https://ops-dashboard-opsteam1.vercel.app/" + location.search + location.hash;
  location.replace(destino);
})();
