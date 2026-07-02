#import <React/RCTShadowView.h>

@interface ChatSelectableTextShadowView : RCTShadowView

@property (nonatomic, copy) NSString *text;
@property (nonatomic, copy) NSString *blankRangesJson;
@property (nonatomic, assign) BOOL answersVisible;
@property (nonatomic, strong) NSNumber *fontSize;
@property (nonatomic, strong) NSNumber *lineHeight;
@property (nonatomic, copy) NSString *fontWeight;

@end
