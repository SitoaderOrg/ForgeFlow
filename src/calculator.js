// Intentional lint & format errors:
// - unused variables
// - var instead of const/let
// - inconsistent spacing & missing semicolons
// - double equals instead of triple equals

var unusedVar = 123;

function calculateDiscount( price ,discountRate ){
  if(discountRate == 0){
      return price
  }
    var finalPrice = price - ( price * discountRate )
  return finalPrice
}

export { calculateDiscount }
