'use client'

import { FileAttachment } from '@/components/FileAttachment'
import { ProgressIndicator } from '@/components/ProgressIndicator'
import { DatesTaken, httpService } from '@/lib/http-service'
import { PayPalButtons, PayPalScriptProvider } from '@paypal/react-paypal-js'
import { useEffect, useState } from 'react'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { useForm } from 'react-hook-form'

interface DogFormData {
  dogName: string
  isRescue: boolean
  caption: string
}

interface OwnerFormData {
  ownerName: string
  city: string
  state: string
  email: string
  isCalendarStand: boolean
}

export default function Home() {
  const [activeIndex, setActiveIndex] = useState(0)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [fileValue, setFileValue] = useState<File | undefined>()
  const [fileError, setFileError] = useState<string>()
  const [datesTaken, setDatesTaken] = useState<DatesTaken>({})
  const [loading, setLoading] = useState(true)
  const [checkout, setCheckout] = useState(false)
  const [postCheckout, setPostCheckout] = useState(false)
  const [postCheckoutText, setPostCheckoutText] = useState('')
  const [freeClaimEligible, setFreeClaimEligible] = useState(true)
  const [isFreeClaim, setIsFreeClaim] = useState(false)

  const isSandbox = process.env.NEXT_PUBLIC_SANDBOX === "true"

  const currentYear = new Date().getFullYear()
  const yearForSelecting = (currentYear + 1).toString()
  const minDate = new Date(currentYear + 1, 0, 1)
  const maxDate = new Date(currentYear + 1, 11, 31)

  const PAYPAL_PRODUCTION_CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || "AeVrUujAwn-me2pUdRlPANmADsETUI9qAZYkd9WIBvovYyoPTH2SnCG_DA8qyIefRBJg2mBdOZpDuGSV"
  const PAYPAL_SANDBOX_CLIENT_ID = "sb"

  const paypalClientId = isSandbox ? PAYPAL_SANDBOX_CLIENT_ID : PAYPAL_PRODUCTION_CLIENT_ID

  const dogForm = useForm<DogFormData>({
    defaultValues: {
      dogName: '',
      isRescue: false,
      caption: ''
    }
  })

  const ownerForm = useForm<OwnerFormData>({
    defaultValues: {
      ownerName: '',
      city: '',
      state: '',
      email: '',
      isCalendarStand: false
    }
  })

  const watchedDogValues = dogForm.watch()
  const watchedOwnerValues = ownerForm.watch()

  const steps = ['Date to appear on', 'Dog Information', 'Owner Information']

  useEffect(() => {
    loadDatesTaken()
  }, [])

  const loadDatesTaken = async () => {
    setLoading(true)
    try {
      const dates = await httpService.getDatesTaken(yearForSelecting)
      setDatesTaken(dates)
    } catch (error) {
      console.error('Error loading dates:', error)
    } finally {
      setLoading(false)
    }
  }

  const filterDate = (date: Date): boolean => {
    const month = date.getMonth() + 1
    const day = date.getDate().toString()
    const year = date.getFullYear().toString()

    if (yearForSelecting === year && datesTaken[month] && datesTaken[month].includes(day)) {
      return false
    }
    return true
  }

  const requirementsMet = (): boolean => {
    switch (activeIndex) {
      case 0:
        return selectedDate !== null
      case 1:
        const dogValues = dogForm.getValues()
        return dogValues.dogName !== '' && dogValues.caption !== '' && fileValue !== undefined
      case 2:
        const ownerValues = ownerForm.getValues()
        return ownerValues.ownerName !== '' &&
          ownerValues.city !== '' &&
          ownerValues.state !== '' &&
          ownerValues.email !== '' &&
          /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(ownerValues.email)
      default:
        return false
    }
  }

  const handleFileChange = (file: File | undefined, error?: string) => {
    setFileValue(file)
    setFileError(error)
  }

  const calculateTotalPrice = (): string => {
    const basePrice = 31.99
    const standPrice = 8.00
    const isCalendarStand = ownerForm.getValues('isCalendarStand')
    return (isCalendarStand ? basePrice + standPrice : basePrice).toFixed(2)
  }

  const handleSubmit = async () => {
    if (isFreeClaim) {
      await handleFreeClaimUpload()
    } else {
      setCheckout(true)
    }
  }

  const handleFreeClaimUpload = async () => {
    setLoading(true)
    try {
      const formData = {
        ...ownerForm.getValues(),
        ...dogForm.getValues()
      }

      if (fileValue && selectedDate) {
        await httpService.uploadToServer(fileValue, formData, selectedDate)
        await loadDatesTaken()
        setPostCheckout(true)
        setFreeClaimEligible(false)
        setPostCheckoutText('Thank you for your order!')
      }
    } catch (error) {
      console.error('Upload error:', error)
      setPostCheckout(true)
      setPostCheckoutText('Thank you for your order!')
    } finally {
      setLoading(false)
    }
  }

  const handlePaymentSuccess = async () => {
    setLoading(true)
    try {
      const formData = {
        ...ownerForm.getValues(),
        ...dogForm.getValues()
      }

      if (fileValue && selectedDate) {
        await httpService.uploadToServer(fileValue, formData, selectedDate)
        await loadDatesTaken()
        await httpService.sendEmail(formData, selectedDate)
        setPostCheckout(true)
        setCheckout(false)
        setPostCheckoutText('Thank you for your order!')
      }
    } catch (error) {
      console.error('Upload error:', error)
      setPostCheckout(true)
      setCheckout(false)
      setPostCheckoutText('Thank you for your order!')
    } finally {
      setLoading(false)
    }
  }

  const handleFreeClaim = () => {
    setIsFreeClaim(true)
    setPostCheckout(false)
    setCheckout(false)
    setActiveIndex(0)
    setSelectedDate(null)
    setFileValue(undefined)
    dogForm.reset()
    ownerForm.reset()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <PayPalScriptProvider options={{
      clientId: paypalClientId,
      currency: "USD",
      intent: "capture",
      components: "buttons",
      ...(isSandbox && {
        buyerCountry: "US",
        debug: true
      })
    }}>
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {isSandbox && (
          <div className="fixed top-4 right-4 bg-white p-4 rounded-lg shadow-md border z-50">
            <div className="mt-2 text-xs text-gray-600">
              <p className="font-semibold mb-1">Test with sandbox accounts:</p>
              <div className="space-y-1">
                <p><strong>Personal Account:</strong></p>
                <p>Email: sb-buyer@personal.example.com</p>
                <p>Password: 12345678</p>
                <p className="mt-2"><strong>Or use test card:</strong></p>
                <p>Card: 4032039534213337</p>
                <p>Exp: 03/2026, CVV: 952</p>
              </div>
            </div>
          </div>
        )}

        <div className="text-center mb-8">
          <img
            src="https://nebula.wsimg.com/7ed305b34a2c74bb96c0b04fe4709b1b?AccessKeyId=CB8124E9BC54ACD9F9F5&disposition=0&alloworigin=1"
            alt="BaRCSE Logo"
            className="mx-auto mb-4"
          />
        </div>

        {!checkout && !postCheckout && (
          <>
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold mb-4">Calendar photo submission</h1>
              <p className="text-gray-600">
                Please fill out the form below to reserve your spot on the calendar.
                A non-selectable date implies that the date has already been reserved by another family.
              </p>
            </div>

            <ProgressIndicator
              activeIndex={activeIndex}
              steps={steps}
            />

            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
              {activeIndex === 0 && (
                <div className="max-w-md mx-auto">
                  <h2 className="text-xl font-semibold mb-4">Select Date</h2>
                  <div className="flex justify-center">
                    <DatePicker
                      selected={selectedDate}
                      onChange={(date) => setSelectedDate(date)}
                      minDate={minDate}
                      maxDate={maxDate}
                      filterDate={filterDate}
                      inline
                      className="mx-auto"
                    />
                  </div>
                </div>
              )}

              {activeIndex === 1 && (
                <form className="max-w-md mx-auto space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Dog(s) name(s) <span className="text-red-500">*</span>
                    </label>
                    <input
                      {...dogForm.register('dogName', { required: true })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 text-black"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Calendar caption <span className="text-red-500">*</span>
                    </label>
                    <input
                      {...dogForm.register('caption', { required: true })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 text-black"
                    />
                  </div>

                  <div className="flex items-center">
                    <input
                      {...dogForm.register('isRescue')}
                      type="checkbox"
                      className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                    />
                    <label className="ml-2 block text-sm text-gray-700">
                      My basset is a rescue
                    </label>
                  </div>

                  <div className="mt-6">
                    <h3 className="text-lg font-medium mb-4">
                      Select an image of your dog(s) to appear on your calendar submission.
                    </h3>
                    <FileAttachment
                      label="Image of dog"
                      acceptedTypes="image/png,image/jpeg"
                      maxFileSize={4000000}
                      value={fileValue}
                      onChange={handleFileChange}
                    />
                    {fileError && (
                      <p className="mt-2 text-sm text-red-600">{fileError}</p>
                    )}
                  </div>
                </form>
              )}

              {activeIndex === 2 && (
                <form className="max-w-md mx-auto space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Owner name <span className="text-red-500">*</span>
                    </label>
                    <input
                      {...ownerForm.register('ownerName', { required: true })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 text-black"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      City <span className="text-red-500">*</span>
                    </label>
                    <input
                      {...ownerForm.register('city', { required: true })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 text-black"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      State <span className="text-red-500">*</span>
                    </label>
                    <select
                      {...ownerForm.register('state', { required: true })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 text-black"
                    >
                      <option value="">Select a state</option>
                      <option value="AL">Alabama</option>
                      <option value="AK">Alaska</option>
                      <option value="AZ">Arizona</option>
                      <option value="AR">Arkansas</option>
                      <option value="CA">California</option>
                      <option value="CO">Colorado</option>
                      <option value="CT">Connecticut</option>
                      <option value="DE">Delaware</option>
                      <option value="DC">District Of Columbia</option>
                      <option value="FL">Florida</option>
                      <option value="GA">Georgia</option>
                      <option value="HI">Hawaii</option>
                      <option value="ID">Idaho</option>
                      <option value="IL">Illinois</option>
                      <option value="IN">Indiana</option>
                      <option value="IA">Iowa</option>
                      <option value="KS">Kansas</option>
                      <option value="KY">Kentucky</option>
                      <option value="LA">Louisiana</option>
                      <option value="ME">Maine</option>
                      <option value="MD">Maryland</option>
                      <option value="MA">Massachusetts</option>
                      <option value="MI">Michigan</option>
                      <option value="MN">Minnesota</option>
                      <option value="MS">Mississippi</option>
                      <option value="MO">Missouri</option>
                      <option value="MT">Montana</option>
                      <option value="NE">Nebraska</option>
                      <option value="NV">Nevada</option>
                      <option value="NH">New Hampshire</option>
                      <option value="NJ">New Jersey</option>
                      <option value="NM">New Mexico</option>
                      <option value="NY">New York</option>
                      <option value="NC">North Carolina</option>
                      <option value="ND">North Dakota</option>
                      <option value="OH">Ohio</option>
                      <option value="OK">Oklahoma</option>
                      <option value="OR">Oregon</option>
                      <option value="PA">Pennsylvania</option>
                      <option value="RI">Rhode Island</option>
                      <option value="SC">South Carolina</option>
                      <option value="SD">South Dakota</option>
                      <option value="TN">Tennessee</option>
                      <option value="TX">Texas</option>
                      <option value="UT">Utah</option>
                      <option value="VT">Vermont</option>
                      <option value="VA">Virginia</option>
                      <option value="WA">Washington</option>
                      <option value="WV">West Virginia</option>
                      <option value="WI">Wisconsin</option>
                      <option value="WY">Wyoming</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email for order <span className="text-red-500">*</span>
                    </label>
                    <input
                      {...ownerForm.register('email', {
                        required: true,
                        pattern: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
                      })}
                      type="email"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 text-black"
                    />
                  </div>

                  <div className="flex items-center">
                    <input
                      {...ownerForm.register('isCalendarStand')}
                      type="checkbox"
                      className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                    />
                    <label className="ml-2 block text-sm text-gray-700">
                      Add Calendar Stand (+$8) - not needed if you have a 4&quot; by 6&quot; stand from a previous Daily Drool calendar
                    </label>
                  </div>
                </form>
              )}
            </div>

            <div className="flex justify-center space-x-4">
              {activeIndex > 0 && (
                <button
                  onClick={() => setActiveIndex(activeIndex - 1)}
                  className="px-6 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Previous
                </button>
              )}

              {activeIndex < steps.length - 1 && (
                <button
                  onClick={() => setActiveIndex(activeIndex + 1)}
                  disabled={!requirementsMet()}
                  className={`px-6 py-2 rounded-md ${requirementsMet()
                    ? 'bg-red-600 text-white hover:bg-red-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                >
                  Next
                </button>
              )}

              {activeIndex === steps.length - 1 && (
                <button
                  onClick={handleSubmit}
                  disabled={!requirementsMet()}
                  className={`px-6 py-2 rounded-md ${requirementsMet()
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                >
                  Save and close
                </button>
              )}
            </div>
          </>
        )}

        {checkout && !isFreeClaim && (
          <div className="text-center">
            <h1 className="text-3xl font-bold mb-8">Checkout</h1>
            <div className="max-w-md mx-auto">
              <PayPalButtons
                createOrder={(data, actions) => {
                  const totalPrice = calculateTotalPrice()
                  const items = [{
                    name: `BaRCSE calendar ${selectedDate?.toLocaleDateString()}`,
                    quantity: '1',
                    unit_amount: {
                      currency_code: 'USD',
                      value: '31.99'
                    }
                  }]

                  if (ownerForm.getValues('isCalendarStand')) {
                    items.push({
                      name: 'Calendar Stand',
                      quantity: '1',
                      unit_amount: {
                        currency_code: 'USD',
                        value: '8.00'
                      }
                    })
                  }

                  return actions.order.create({
                    intent: 'CAPTURE',
                    purchase_units: [{
                      amount: {
                        currency_code: 'USD',
                        value: totalPrice,
                        breakdown: {
                          item_total: {
                            currency_code: 'USD',
                            value: totalPrice
                          }
                        }
                      },
                      items: items
                    }]
                  })
                }}
                onApprove={async (data, actions) => {
                  await handlePaymentSuccess()
                }}
                onCancel={() => {
                  setCheckout(false)
                }}
                onError={(err) => {
                  console.error('PayPal error:', err)
                  setCheckout(false)
                  alert('PayPal could not process your order. Please try again.')
                }}
              />
            </div>
          </div>
        )}

        {postCheckout && (
          <div className="text-center">
            <h1 className="text-3xl font-bold mb-8">{postCheckoutText}</h1>
            {!isFreeClaim && freeClaimEligible && (
              <>
                <h2 className="text-xl mb-4">
                  Would you like to reserve a second calendar space, free of charge? :)
                </h2>
                <button
                  onClick={handleFreeClaim}
                  className="px-6 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 mb-4"
                >
                  Claim free space
                </button>
              </>
            )}
            <div>
              <a
                href="http://www.barcse.org/"
                className="inline-block px-6 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                Return to Barcse
              </a>
            </div>
          </div>
        )}
      </main>
    </PayPalScriptProvider>
  )
}
