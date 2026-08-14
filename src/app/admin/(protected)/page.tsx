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

      {/* Export and stand-request email controls live inside OrdersTable so they follow
          the selected year. */}
      <OrdersTable />
    </main>
  )
}
