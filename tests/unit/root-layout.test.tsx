import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'

import RootLayout from '@/app/layout'

it('renders page content inside the root document', () => {
  render(<RootLayout><main>content</main></RootLayout>)
  expect(screen.getByText('content')).toBeInTheDocument()
  expect(screen.queryByTestId('application-socket')).not.toBeInTheDocument()
})
