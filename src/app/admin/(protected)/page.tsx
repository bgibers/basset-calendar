import OrdersTable from '@/components/admin/OrdersTable'

export default function AdminDashboard() {
  return (
    <main className="min-h-screen p-4 space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold">Calendar orders dashboard</h1>
        <p className="text-sm text-gray-600">
          Review orders, spot data problems, and record each dog&apos;s stand option.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded border p-3">
          <h2 className="font-semibold">Export</h2>
          <p className="text-sm text-gray-600">CSV and monthly photo ZIP downloads (coming soon).</p>
        </section>
        <section className="rounded border p-3">
          <h2 className="font-semibold">Email</h2>
          <p className="text-sm text-gray-600">Stand-request emails to owners (coming soon).</p>
        </section>
      </div>

      <OrdersTable />
    </main>
  )
}
