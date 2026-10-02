export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-white p-4">
      <h2 className="text-3xl font-bold mb-2 text-cyan-400">404 - Page Not Found</h2>
      <p className="text-slate-400 mb-6 text-sm">The page you are looking for does not exist.</p>
      <a
        href="/store"
        className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm text-white font-medium transition-all"
      >
        Return to Demo Store
      </a>
    </div>
  );
}
