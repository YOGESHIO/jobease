# RojgaarSetu Architecture Suggestion

## Frontend Component Structure

Recommended stack: React with Tailwind CSS.

```text
src/
  app/
    App.tsx
    routes.tsx
  components/
    layout/Header.tsx
    layout/Footer.tsx
    services/ServiceCard.tsx
    services/ServiceSearch.tsx
    pricing/PricingCalculator.tsx
    auth/LoginModal.tsx
    booking/BookingTracker.tsx
    training/CourseCard.tsx
    admin/DashboardMetric.tsx
  pages/
    HomePage.tsx
    ServicesPage.tsx
    WorkerOnboardingPage.tsx
    TrainingPortalPage.tsx
    AdminDashboardPage.tsx
  state/
    authStore.ts
    bookingStore.ts
  api/
    client.ts
    servicesApi.ts
    bookingsApi.ts
    workersApi.ts
    coursesApi.ts
```

## Database Schema

Use PostgreSQL for clean relational reporting.

```sql
users(id, name, phone, email, password_hash, role, preferred_language, created_at)
customers(id, user_id, address_json, loyalty_points)
workers(id, user_id, aadhaar_status, pan_status, police_status, rating, is_available, wallet_balance)
worker_skills(id, worker_id, service_id, level, certificate_id)
services(id, name, category, base_charge, hourly_rate, platform_fee, gst_rate, is_active)
bookings(id, customer_id, worker_id, service_id, status, hours, urgency, distance_km, material_needed, estimate_total, final_total, scheduled_at)
payments(id, booking_id, razorpay_order_id, amount, status, paid_at)
reviews(id, booking_id, customer_id, worker_id, rating, comment, created_at)
courses(id, title, skill_category, price, duration_minutes, is_active)
course_lessons(id, course_id, title, video_url, sort_order)
course_progress(id, worker_id, course_id, completed_percent, quiz_score, completed_at)
certificates(id, worker_id, course_id, certificate_url, issued_at)
subscriptions(id, worker_id, plan_name, price, lead_limit, starts_at, ends_at)
leads(id, customer_id, service_id, city, budget, status, created_at)
disputes(id, booking_id, raised_by_user_id, status, resolution_note, created_at)
notifications(id, user_id, channel, title, body, sent_at)
```

## .NET Core API Architecture

```text
RojgaarSetu.Api/
  Controllers/
    AuthController.cs
    ServicesController.cs
    BookingsController.cs
    WorkersController.cs
    TrainingController.cs
    PaymentsController.cs
    AdminController.cs
  Application/
    Pricing/PricingService.cs
    Matching/WorkerRecommendationService.cs
    Notifications/NotificationService.cs
  Infrastructure/
    Data/AppDbContext.cs
    Razorpay/RazorpayClient.cs
    Storage/DocumentStorage.cs
  Domain/
    User.cs
    Worker.cs
    Booking.cs
    Service.cs
    Course.cs
```

Core API endpoints:

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/services
POST /api/pricing/estimate
POST /api/bookings
GET  /api/bookings/{id}/track
POST /api/bookings/{id}/review
POST /api/workers/register
POST /api/workers/documents
PATCH /api/workers/availability
GET  /api/workers/earnings
GET  /api/training/courses
POST /api/training/progress
POST /api/payments/razorpay/order
POST /api/payments/razorpay/webhook
GET  /api/admin/analytics
PATCH /api/admin/workers/{id}/verify
```

Authentication: JWT with role-based policies for `Customer`, `Worker`, and `Admin`.

## Mobile App Structure

Recommended stack: React Native or Flutter.

```text
mobile/
  customer/
    Home
    SearchServices
    BookingFlow
    Tracking
    Payments
    Reviews
  worker/
    Onboarding
    Verification
    Availability
    JobRequests
    EarningsWallet
    Training
    Certificates
  shared/
    Auth
    Notifications
    LanguageSelector
    Chat
```

## Professional UX Flow

Customer:

```text
Search service -> View estimate -> Login -> Confirm address/time -> Pay -> Track worker -> Chat -> Complete -> Rate -> Download invoice
```

Worker:

```text
Register -> Upload Aadhaar/PAN -> Select skills -> Complete training -> Get verified -> Toggle availability -> Accept job -> Complete job -> Receive payout
```

Admin:

```text
Monitor dashboard -> Verify workers -> Manage pricing -> Manage courses -> Resolve disputes -> Monitor payments and reports
```

## Cloud Ready Notes

- Host React app on Azure Static Web Apps, AWS Amplify, or CloudFront + S3.
- Host .NET Core API on Azure App Service, AWS ECS, or Elastic Beanstalk.
- Use Azure Database for PostgreSQL or AWS RDS.
- Store documents and certificates in Azure Blob Storage or AWS S3.
- Use Razorpay for payments and webhooks.
- Use SMS and email providers for OTP, booking updates, and certificates.
- Add push notifications with Firebase Cloud Messaging.
- Add AI worker recommendation using distance, rating, availability, skill match, cancellation rate, and price fit.
