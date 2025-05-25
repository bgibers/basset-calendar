'use client'

import React from 'react'

interface ProgressIndicatorProps {
  activeIndex: number
  steps: string[]
  onStepClick?: (index: number) => void
}

export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  activeIndex,
  steps,
  onStepClick
}) => {
  return (
    <div className="flex items-center justify-center mb-8">
      {steps.map((step, index) => (
        <React.Fragment key={index}>
          <div className="flex flex-col items-center">
            <button
              onClick={() => onStepClick?.(index)}
              disabled={!onStepClick}
              className={`
                w-12 h-12 rounded-full flex items-center justify-center font-semibold
                transition-colors duration-200
                ${index < activeIndex
                  ? 'bg-green-600 text-white'
                  : index === activeIndex
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-300 text-gray-600'
                }
                ${onStepClick ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}
              `}
            >
              {index < activeIndex ? '✓' : index + 1}
            </button>
            <span className="mt-2 text-sm text-gray-600 max-w-[100px] text-center">
              {step}
            </span>
          </div>
          {index < steps.length - 1 && (
            <div
              className={`
                w-24 h-1 mx-2 transition-colors duration-200
                ${index < activeIndex ? 'bg-green-600' : 'bg-gray-300'}
              `}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}
