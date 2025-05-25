'use client'

import React, { useRef, useState } from 'react'

interface FileAttachmentProps {
  label: string
  acceptedTypes: string
  maxFileSize: number
  value?: File
  onChange: (file: File | undefined, error?: string) => void
}

export const FileAttachment: React.FC<FileAttachmentProps> = ({
  label,
  acceptedTypes,
  maxFileSize,
  value,
  onChange
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      onChange(undefined)
      setPreview(null)
      return
    }

    // Validate file type
    const acceptedTypesList = acceptedTypes.split(',').map(type => type.trim())
    if (!acceptedTypesList.includes(file.type)) {
      onChange(undefined, `Please upload a file of type ${acceptedTypes}`)
      setPreview(null)
      return
    }

    // Validate file size
    if (file.size > maxFileSize) {
      const maxSizeKB = Math.round(maxFileSize / 1024)
      onChange(undefined, `Please upload a file smaller than ${maxSizeKB} KB`)
      setPreview(null)
      return
    }

    // Create preview for images
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setPreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }

    onChange(file)
  }

  const handleRemove = () => {
    onChange(undefined)
    setPreview(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="w-full">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        {label}
      </label>

      {!value ? (
        <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md">
          <div className="space-y-1 text-center">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              stroke="currentColor"
              fill="none"
              viewBox="0 0 48 48"
              aria-hidden="true"
            >
              <path
                d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="flex text-sm text-gray-600">
              <label
                htmlFor="file-upload"
                className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-blue-500"
              >
                <span>Upload a file</span>
                <input
                  id="file-upload"
                  ref={fileInputRef}
                  type="file"
                  className="sr-only"
                  accept={acceptedTypes}
                  onChange={handleFileChange}
                />
              </label>
              <p className="pl-1">or drag and drop</p>
            </div>
            <p className="text-xs text-gray-500">
              {acceptedTypes.split(',').join(', ')} up to {Math.round(maxFileSize / 1024 / 1024)}MB
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-1 flex items-center space-x-4 p-4 border border-gray-300 rounded-md">
          {preview && (
            <img
              src={preview}
              alt="Preview"
              className="h-20 w-20 object-cover rounded"
            />
          )}
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">{value.name}</p>
            <p className="text-sm text-gray-500">
              {Math.round(value.size / 1024)} KB
            </p>
          </div>
          <button
            type="button"
            onClick={handleRemove}
            className="text-red-600 hover:text-red-500"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  )
}
