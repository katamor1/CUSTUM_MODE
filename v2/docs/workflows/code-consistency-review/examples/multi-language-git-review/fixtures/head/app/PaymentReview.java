class PaymentReview {
  // threshold aligned with REQ-ML-001
  String status(int input) { return input > 100 ? "review" : "ok"; }
}
