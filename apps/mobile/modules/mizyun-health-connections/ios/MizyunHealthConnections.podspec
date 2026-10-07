Pod::Spec.new do |s|
  s.name             = 'MizyunHealthConnections'
  s.version          = '1.0.0'
  s.summary          = 'Local read-only health previews for Mizyun.'
  s.description      = 'Optional foreground HealthKit weight and workout previews.'
  s.license          = { :type => 'MIT' }
  s.author           = 'Mizyun'
  s.homepage         = 'https://www.phiskel.com/mizyun'
  s.platform         = :ios, '16.4'
  s.swift_version    = '5.9'
  s.source           = { :git => 'https://github.com/AdamHikl/mizyun.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks        = 'HealthKit'
  s.source_files      = '**/*.swift'
end
