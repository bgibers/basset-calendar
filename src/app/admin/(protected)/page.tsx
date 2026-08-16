import OrdersTable from '@/components/admin/OrdersTable'
import SettingsCard from '@/components/admin/SettingsCard'

export default function AdminDashboard() {
  return (
    <main className="min-h-screen bg-gray-100 p-4 text-gray-900">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h1 className="text-xl font-bold text-gray-900">
            BaRCSE Basset-a-Day Calendar — Admin
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Review orders, spot data problems, and record each dog&apos;s stand option.
          </p>
        </header>

        <SettingsCard />

        {/* Export and stand-request email controls live inside OrdersTable so they follow
            the selected year. */}
        <OrdersTable />
      </div>
    </main>
  )
}
